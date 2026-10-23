"""Parse supplied source only. Never import or execute the analyzed project."""
import bisect
import ast
import json
import io
import keyword
import re
import sys
import tokenize
import unicodedata


FEATURE_OPERATOR_TEXT = frozenset({
    "+", "-", "*", "**", "/", "//", "%", "@", "<<", ">>", "&", "|", "^", "~",
    "<", "<=", ">", ">=", "==", "!=", "=", ":=", "+=", "-=", "*=", "/=", "//=",
    "%=", "@=", "&=", "|=", "^=", "<<=", ">>=", "**=", "->", "!", "and", "or",
    "not", "in", "is",
})
FEATURE_TRIVIA = frozenset({
    tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
    tokenize.DEDENT, tokenize.ENDMARKER, tokenize.ENCODING,
})
FEATURE_LITERAL_NAMES = frozenset({"True", "False", "None"})
FEATURE_FSTRING_TYPES = frozenset(filter(None, (
    getattr(tokenize, "FSTRING_START", None),
    getattr(tokenize, "FSTRING_MIDDLE", None),
    getattr(tokenize, "FSTRING_END", None),
)))
FEATURE_SOFT_KEYWORDS = frozenset(getattr(keyword, "softkwlist", ()))
FEATURE_MAX_TOKENS_PER_DECLARATION = 20000
FEATURE_MAX_AST_NODES_PER_DECLARATION = 20000
FEATURE_MAX_TOKENS_PER_DOCUMENT = 100000
FEATURE_MAX_AST_NODES_PER_DOCUMENT = 200000
FEATURE_MAX_SCANNED_TOKENS_PER_DOCUMENT = 200000
FEATURE_MAX_DECLARATIONS_PER_DOCUMENT = 20000


class FeatureBudget:
    def __init__(self):
        self.tokens = 0
        self.ast_nodes = 0

    def add_tokens(self, count):
        if count > FEATURE_MAX_TOKENS_PER_DECLARATION:
            raise ValueError("python-strand-features-token-budget")
        self.tokens += count
        if self.tokens > FEATURE_MAX_TOKENS_PER_DOCUMENT:
            raise ValueError("python-strand-features-document-token-budget")

    def add_ast_nodes(self, count):
        if count > FEATURE_MAX_AST_NODES_PER_DECLARATION:
            raise ValueError("python-strand-features-ast-budget")
        self.ast_nodes += count
        if self.ast_nodes > FEATURE_MAX_AST_NODES_PER_DOCUMENT:
            raise ValueError("python-strand-features-document-ast-budget")


def feature_category(token_type, text):
    if token_type == tokenize.NAME:
        if text in FEATURE_LITERAL_NAMES:
            return "literal"
        if text in FEATURE_OPERATOR_TEXT:
            return "operator"
        if keyword.iskeyword(text) or text in FEATURE_SOFT_KEYWORDS:
            return "keyword"
        return "identifier"
    if token_type in (tokenize.NUMBER, tokenize.STRING, tokenize.ELLIPSIS) or token_type in FEATURE_FSTRING_TYPES:
        return "literal"
    if token_type == tokenize.OP:
        return "operator" if text in FEATURE_OPERATOR_TEXT else "punctuation"
    raise ValueError("python-strand-features-unknown-token")


def feature_token_records(tokens, text, raw_offsets, char_position, ranges):
    records = []
    range_index = 0
    scanned = 0
    merged_ranges = []
    for start, end in sorted(ranges, key=lambda item: (item[0], item[1])):
        if merged_ranges and start <= merged_ranges[-1][1]:
            merged_ranges[-1] = (merged_ranges[-1][0], max(merged_ranges[-1][1], end))
        else:
            merged_ranges.append((start, end))
    for token in tokens:
        scanned += 1
        if scanned > FEATURE_MAX_SCANNED_TOKENS_PER_DOCUMENT:
            raise ValueError("python-strand-features-scanned-token-budget")
        if token.type in FEATURE_TRIVIA:
            continue
        token_start = char_position(*token.start)
        token_end = char_position(*token.end)
        while range_index < len(merged_ranges) and token_start >= merged_ranges[range_index][1]:
            range_index += 1
        if range_index >= len(merged_ranges):
            break
        if token_end <= merged_ranges[range_index][0] or token_start >= merged_ranges[range_index][1]:
            continue
        if not (1 <= token.start[0] <= len(raw_offsets) and 1 <= token.end[0] <= len(raw_offsets)):
            raise ValueError("python-strand-features-token-position")
        raw_start = raw_offsets[token.start[0] - 1] + token.start[1]
        raw_end = raw_offsets[token.end[0] - 1] + token.end[1]
        if raw_start < 0 or raw_end < raw_start or raw_end > len(text):
            raise ValueError("python-strand-features-token-range")
        raw_text = text[raw_start:raw_end]
        category = feature_category(token.type, raw_text)
        records.append(dict(start=token_start, end=token_end, text=raw_text,
                            category=category, key=category + ":" + raw_text))
        if len(records) > FEATURE_MAX_TOKENS_PER_DOCUMENT:
            raise ValueError("python-strand-features-document-token-budget")
    return records


def feature_ast_histogram(node, budget):
    counts = {}
    stack = [node]
    seen = 0
    while stack:
        current = stack.pop()
        seen += 1
        if seen > FEATURE_MAX_AST_NODES_PER_DECLARATION:
            raise ValueError("python-strand-features-ast-budget")
        if not isinstance(current, (ast.Name, ast.Constant, ast.expr_context)):
            kind = type(current).__name__
            counts[kind] = counts.get(kind, 0) + 1
        children = list(ast.iter_child_nodes(current))
        stack.extend(reversed(children))
    budget.add_ast_nodes(seen)
    return dict(sorted(counts.items()))


def feature_token_slice(records, starts, start, end):
    left = bisect.bisect_left(starts, start)
    right = bisect.bisect_left(starts, end)
    return [record for record in records[left:right] if record["end"] <= end]


def public_feature_tokens(records):
    return [dict(key=record["key"], category=record["category"], text=record["text"])
            for record in records]


def declaration_name_token(node, tokens, node_start, body_start):
    keyword_text = "class" if isinstance(node, ast.ClassDef) else "def"
    declaration_tokens = [token for token in tokens
                          if node_start <= token["start"] < body_start]
    keyword_index = next((index for index, token in enumerate(declaration_tokens)
                          if token["text"] == keyword_text), None)
    if keyword_index is None or keyword_index + 1 >= len(declaration_tokens):
        raise ValueError("python-strand-features-missing-declaration-keyword")
    name_token = declaration_tokens[keyword_index + 1]
    if unicodedata.normalize("NFKC", name_token["text"]) != node.name:
        raise ValueError("python-strand-features-missing-declaration-name")
    return name_token


def suite_start(node, decorators_by_column, decorator_lines_by_column, position):
    if not node.body:
        raise ValueError("python-strand-features-missing-suite")
    first = node.body[0]
    decorator_list = getattr(first, "decorator_list", ())
    if decorator_list:
        first_expression = min(decorator.lineno for decorator in decorator_list)
        column = first.col_offset
        index = bisect.bisect_right(decorator_lines_by_column.get(column, ()), first_expression) - 1
        if index < 0:
            raise ValueError("python-strand-features-missing-nested-decorator")
        return position(*decorators_by_column[column][index].start)
    return position(first.lineno, first.col_offset)


def _add_strand_features(entries, nodes, tokens, text, raw_offsets, decorators, char_position, position):
    if len(entries) > FEATURE_MAX_DECLARATIONS_PER_DOCUMENT:
        raise ValueError("python-strand-features-declaration-budget")
    ranges = [(entry["start"], entry["end"]) for entry in entries]
    records = feature_token_records(tokens, text, raw_offsets, char_position, ranges)
    starts = [record["start"] for record in records]
    decorators_by_column = {}
    decorator_lines_by_column = {}
    for decorator in decorators:
        column = decorator.start[1]
        decorators_by_column.setdefault(column, []).append(decorator)
        decorator_lines_by_column.setdefault(column, []).append(decorator.start[0])
    budget = FeatureBudget()
    for entry, node in zip(entries, nodes):
        body_start = suite_start(node, decorators_by_column, decorator_lines_by_column, position)
        declaration_tokens = feature_token_slice(records, starts, entry["start"], entry["end"])
        header_tokens = [token for token in declaration_tokens if token["start"] < body_start]
        body_tokens = [token for token in declaration_tokens if token["start"] >= body_start]
        name_token = declaration_name_token(node, header_tokens,
                                            position(node.lineno, node.col_offset), body_start)
        header_tokens = [token for token in header_tokens if token is not name_token]
        budget.add_tokens(len(declaration_tokens))
        entry["strandFeatures"] = dict(
            version=1,
            headerTokens=public_feature_tokens(header_tokens),
            bodyTokens=public_feature_tokens(body_tokens),
            ast=feature_ast_histogram(node, budget),
        )


def add_strand_features(entries, nodes, tokens, text, raw_offsets, decorators, char_position, position):
    try:
        _add_strand_features(entries, nodes, tokens, text, raw_offsets, decorators, char_position, position)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("python-strand-features-failed: " + type(error).__name__) from error


def inventory(path, text, strand_features=False):
    # splitlines() also splits form feeds, which are legal Python indentation.
    lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)
    utf16 = text.encode("utf-16-le")
    offsets = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line.encode("utf-16-le")) // 2
    raw_offsets = []
    raw_offset = 0
    for line in lines:
        raw_offsets.append(raw_offset)
        raw_offset += len(line)

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
    entries, declaration_nodes, exclusions = [], [], []

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
            declaration_nodes.append(node)
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
    if strand_features and entries:
        add_strand_features(entries, declaration_nodes, tokens, text, raw_offsets,
                            decorators, char_position, position)
    return dict(entries=entries, exclusions=exclusions)


def main():
    if sys.implementation.name != "cpython" or sys.version_info < (3, 8):
        raise RuntimeError("CPython 3.8 or newer required")
    strand_features = "--strand-features" in sys.argv[1:]
    files = json.load(sys.stdin)
    documents = {}
    for path, text in files.items():
        try:
            documents[path] = dict(status="complete", diagnostics=[],
                                    **inventory(path, text, strand_features=strand_features and path.endswith(".py")))
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
