"""Parse supplied source only. Never import or execute the analyzed project."""
import ast
import json
import io
import re
import sys
import tokenize


def inventory(path, text):
    # splitlines() also splits form feeds, which are legal Python indentation.
    lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)
    utf16 = text.encode("utf-16-le")
    offsets = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line.encode("utf-16-le")) // 2

    def position(line, byte_column):
        prefix = lines[line - 1].encode("utf-8")[:byte_column].decode("utf-8")
        return offsets[line - 1] + len(prefix.encode("utf-16-le")) // 2

    def char_position(line, column):
        return offsets[line - 1] + len(lines[line - 1][:column].encode("utf-16-le")) // 2

    tokens = list(tokenize.generate_tokens(io.StringIO(text.replace("\r\n", "\n").replace("\r", "\n")).readline))
    decorators, comments = [], []
    statement_start = True
    for token in tokens:
        if token.type == tokenize.COMMENT:
            comments.append(token)
        elif token.type == tokenize.NEWLINE:
            statement_start = True
        elif token.type not in (tokenize.NL, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER, tokenize.ENCODING):
            if statement_start and token.string == "@":
                decorators.append(token)
            statement_start = False

    tree = ast.parse(text, filename=path)
    entries, exclusions = [], []

    def visit(node, parent=None, parent_kind=None):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            is_class = isinstance(node, ast.ClassDef)
            kind = "class" if is_class else "method" if parent_kind == "class" else "function"
            start = position(node.lineno, node.col_offset)
            end = position(node.end_lineno, node.end_col_offset)
            ast_end = end
            # Only adjacent comments in this declaration's suite, or on its
            # final code line, may extend it. Never consume another statement.
            cursor = end
            end_line = node.end_lineno
            for comment in comments:
                comment_start = char_position(*comment.start)
                if comment_start < cursor:
                    continue
                # Compare source in UTF-16 coordinates without normalizing it.
                between = utf16[cursor * 2:comment_start * 2].decode("utf-16-le")
                if between.strip() or (comment.start[0] > node.end_lineno and comment.start[1] <= node.col_offset):
                    break
                cursor = char_position(*comment.end)
                end = cursor
                end_line = comment.end[0]
            first_line = node.lineno
            if node.decorator_list:
                first_expression = min(d.lineno for d in node.decorator_list)
                matching = [t for t in decorators if t.start[0] <= first_expression and t.start[1] == node.col_offset]
                if not matching:
                    raise ValueError("missing decorator boundary")
                first_line = matching[-1].start[0]
                start = char_position(*matching[-1].start)
            name = node.name
            qualified = parent + "." + name if parent else name
            entries.append(dict(name=name, qualifiedName=qualified, kind=kind,
                                parent=parent, callable=not is_class, start=start, end=end,
                                startLine=first_line - 1, endLine=end_line,
                                engineRanges=[dict(start=position(node.lineno, node.col_offset), end=e) for e in sorted({ast_end, end})]))
            for child in node.body:
                visit(child, qualified, kind)
            return
        if isinstance(node, ast.Lambda):
            exclusions.append(dict(start=position(node.lineno, node.col_offset), reason="python-lambda-not-inventoried"))
            return
        if parent is None and isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            exclusions.append(dict(start=position(node.lineno, node.col_offset), reason="python-binding-not-inventoried"))
        if parent is None and isinstance(node, ast.Expr) and not isinstance(node.value, ast.Constant):
            exclusions.append(dict(start=position(node.lineno, node.col_offset), reason="python-top-level-expression-not-inventoried"))
        for child in ast.iter_child_nodes(node):
            visit(child, parent, parent_kind)

    visit(tree)
    return dict(entries=entries, exclusions=exclusions)


def main():
    if sys.implementation.name != "cpython" or sys.version_info < (3, 8):
        raise RuntimeError("CPython 3.8 or newer required")
    files = json.load(sys.stdin)
    documents = {}
    for path, text in files.items():
        try:
            documents[path] = dict(status="complete", diagnostics=[], **inventory(path, text))
        except (SyntaxError, ValueError, RecursionError, tokenize.TokenError, IndentationError) as error:
            diagnostic = dict(message=type(error).__name__ + ": " + str(error))
            # SyntaxError uses one-based character columns; tokenize uses
            # zero-based character columns. Neither uses AST's UTF-8 columns.
            line, column = getattr(error, "lineno", None), getattr(error, "offset", None)
            if line is not None:
                column = max(0, (column or 1) - 1)
            elif isinstance(error, tokenize.TokenError) and len(error.args) > 1:
                line, column = error.args[1]
            if isinstance(line, int) and line > 0 and isinstance(column, int):
                lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)
                prefix = "".join(lines[:line - 1]) + (lines[line - 1][:max(0, column)] if line <= len(lines) else "")
                diagnostic["start"] = len(prefix.encode("utf-16-le")) // 2
            documents[path] = dict(status="invalid", entries=[], exclusions=[],
                                   diagnostics=[diagnostic])
    json.dump(dict(parser="cpython@" + sys.version.split()[0], documents=documents), sys.stdout)


if __name__ == "__main__":
    main()
