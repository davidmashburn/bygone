#!/usr/bin/env python3
"""Conservative, source-only Python dependency evidence for Bygone.

The input and output are JSON.  The analyzed files are never opened, imported,
or executed; every lookup is against the supplied in-memory source map.
"""

import ast
import json
import posixpath
import sys


MAX_AST_NODES = 150000
MAX_DECLARATION_NODES = 5000
MAX_SITES = 5000
MAX_DIAGNOSTICS = 100


# Keep syntax checks compatible with the oldest Python versions that can run
# this adapter.  Referencing ast.TryStar or ast.Match directly would raise an
# AttributeError on otherwise ordinary source when those AST classes are not
# present.
TRY_NODES = tuple(node_type for node_type in (ast.Try, getattr(ast, "TryStar", None)) if node_type)
MATCH_NODES = tuple(node_type for node_type in (getattr(ast, "Match", None),) if node_type)


def utf16_length(value):
    return len(value.encode("utf-16-le")) // 2


def python_source_lines(text):
    """Split source using the newline sequences Python gives to the AST.

    ``str.splitlines`` also treats Unicode separators and formfeed as line
    breaks.  Python's AST line numbers do not, so those characters must stay
    in the line that contains them (including when they occur in a literal or
    comment).
    """
    lines = []
    start = 0
    index = 0
    while index < len(text):
        character = text[index]
        if character == "\n":
            lines.append(text[start:index + 1])
            start = index + 1
            index += 1
            continue
        if character == "\r":
            end = index + 1
            if end < len(text) and text[end] == "\n":
                end += 1
            lines.append(text[start:end])
            start = end
            index = end
            continue
        index += 1
    if start < len(text) or not lines:
        lines.append(text[start:])
    return lines


class PositionMap:
    def __init__(self, text):
        self.text = text
        self.lines = python_source_lines(text)
        self.starts = []
        offset = 0
        for line in self.lines:
            self.starts.append(offset)
            offset += utf16_length(line)
        self.length = offset

    def ast_position(self, line, byte_column):
        if not isinstance(line, int) or line < 1:
            return 0
        index = min(line - 1, len(self.lines) - 1)
        line_text = self.lines[index]
        try:
            prefix = line_text.encode("utf-8")[:max(0, byte_column)].decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            prefix = line_text[:max(0, byte_column)]
        return self.starts[index] + utf16_length(prefix)

    def syntax_position(self, line, character_column):
        if not isinstance(line, int) or line < 1:
            return 0
        index = min(line - 1, len(self.lines) - 1)
        return self.starts[index] + utf16_length(self.lines[index][:max(0, character_column)])

    def span(self, node, fallback=None):
        if hasattr(node, "lineno") and hasattr(node, "col_offset"):
            start = self.ast_position(node.lineno, node.col_offset)
            if hasattr(node, "end_lineno") and hasattr(node, "end_col_offset"):
                end = self.ast_position(node.end_lineno, node.end_col_offset)
                return start, max(start, end)
            return start, start
        if fallback is not None:
            return fallback
        return 0, 0


def clean_path(value):
    value = str(value).replace("\\", "/")
    normalized = posixpath.normpath(value)
    if normalized == ".":
        return ""
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def public_path(value):
    normalized = clean_path(value)
    if normalized.startswith("/"):
        # Targets must not leak absolute paths.  Absolute input keys are not a
        # supported project layout, but retaining a relative display name is
        # safer than emitting an absolute target.
        return normalized.lstrip("/") or "<root>"
    return normalized


def module_parts(value):
    value = clean_path(value)
    if value.endswith(".pyi"):
        value = value[:-4]
    elif value.endswith(".py"):
        value = value[:-3]
    return tuple(part for part in value.split("/") if part)


def ref_key(ref):
    return (ref.file.key, ref.node.id if ref.node is not None else None)


def unique_refs(refs):
    result = []
    seen = set()
    for ref in refs:
        key = ref_key(ref)
        if key not in seen:
            seen.add(key)
            result.append(ref)
    return result


class Ref:
    def __init__(self, file_info, node=None):
        self.file = file_info
        self.node = node

    def candidate(self):
        result = {"file": public_path(self.file.key)}
        if self.node is not None:
            result["node"] = self.node.id
        return result


class NodeInfo:
    def __init__(self, document, name, kind, start, end, ast_node):
        self.document = document
        self.name = name
        self.kind = kind
        self.start = start
        self.end = end
        self.id = "<init>" if kind == "module-init" else name + "@" + str(start)
        self.ast_node = ast_node
        self.scope = None

    def record(self):
        return {"id": self.id, "name": self.name, "kind": self.kind,
                "start": self.start, "end": self.end}


class Binding:
    def __init__(self, kind, reason=""):
        self.kind = kind
        self.reason = reason
        self.node = None
        self.refs = []
        self.imports = []
        self.unknown_attributes = set()
        self.unknown_attribute_writes = False
        self.status = "unresolved"


class Scope:
    def __init__(self, document, kind, owner, parent_lookup=None, containing=None):
        self.document = document
        self.kind = kind
        self.owner = owner
        self.parent_lookup = parent_lookup
        self.containing = containing
        self.bindings = {}
        self.global_names = set()
        self.nonlocal_names = set()
        self.children = {}
        self.import_records = []
        self.module_scope = self if kind == "module" else document.root_scope

    def binding_scope(self, name):
        if name in self.global_names:
            return self.module_scope
        if name in self.nonlocal_names:
            candidate = self.parent_lookup
            while candidate is not None and candidate.kind == "class":
                candidate = candidate.parent_lookup
            return candidate if candidate is not None else self
        return self

    def add_definition(self, name, node):
        target = self.binding_scope(name)
        existing = target.bindings.get(name)
        if existing is None:
            binding = Binding("def")
            binding.node = node
            target.bindings[name] = binding
        elif existing.kind in ("unknown", "param"):
            return
        elif existing.kind == "def":
            binding = Binding("ambiguous", "multiple local definitions")
            binding.refs = unique_refs([Ref(self.document, existing.node), Ref(self.document, node)])
            target.bindings[name] = binding
        elif existing.kind == "ambiguous":
            existing.refs = unique_refs(existing.refs + [Ref(self.document, node)])
        else:
            existing.kind = "ambiguous"
            existing.reason = "local definition conflicts with another binding"
            existing.refs = unique_refs(existing.refs + [Ref(self.document, node)])

    def add_param(self, name):
        target = self.binding_scope(name)
        if target is not self:
            target.add_unknown(name, "global or nonlocal parameter")
            return
        target.bindings[name] = Binding("param", "parameter shadows an outer binding")

    def add_unknown(self, name, reason="local name is rebound"):
        target = self.binding_scope(name)
        if target is not self and target is not self.module_scope:
            target.add_unknown(name, reason)
            return
        existing = target.bindings.get(name)
        if existing is not None and existing.kind == "param":
            return
        target.bindings[name] = Binding("unknown", reason)

    def add_import(self, name, record):
        target = self.binding_scope(name)
        if target is not self:
            target.add_import(name, record)
            return
        existing = target.bindings.get(name)
        if existing is None:
            binding = Binding("import")
            binding.imports.append(record)
            target.bindings[name] = binding
        elif existing.kind in ("unknown", "param"):
            return
        elif existing.kind == "import":
            existing.imports.append(record)
        elif existing.kind == "ambiguous":
            existing.imports.append(record)
        else:
            binding = Binding("ambiguous", "import conflicts with a local definition")
            binding.refs = unique_refs(existing.refs + [])
            binding.imports.append(record)
            target.bindings[name] = binding

    def lookup(self, name):
        if name in self.global_names:
            return self.module_scope.bindings.get(name)
        if name in self.nonlocal_names:
            candidate = self.parent_lookup
            while candidate is not None and candidate.kind == "class":
                candidate = candidate.parent_lookup
            return candidate.lookup(name) if candidate is not None else None
        if name in self.bindings:
            return self.bindings[name]
        return self.parent_lookup.lookup(name) if self.parent_lookup is not None else None


class ImportRecord:
    def __init__(self, document, scope, node, alias, kind, specifier,
                 binding_name, imported_name, level, type_context):
        self.document = document
        self.scope = scope
        self.node = node
        self.alias = alias
        self.kind = kind
        self.specifier = specifier
        self.binding_name = binding_name
        self.imported_name = imported_name
        self.level = level
        self.type_context = type_context
        self.base_module_names = []
        self.status = "unresolved"
        self.refs = []
        self.reason = ""
        self.site_start, self.site_end = document.position.span(alias, document.position.span(node))

    @property
    def owner(self):
        return self.scope.owner

    @property
    def phase(self):
        if self.document.is_stub or self.type_context:
            return "type"
        return self.document.phase_for_scope(self.scope)


class Document:
    def __init__(self, key, text):
        self.key = key
        self.text = text
        self.position = PositionMap(text)
        self.is_stub = clean_path(key).endswith(".pyi")
        self.tree = None
        self.status = "complete"
        self.diagnostics = []
        self.sites = []
        self.site_limited = False
        self.nodes = []
        self.node_by_ast = {}
        self.root_scope = None
        self.all_names = set()
        self.future_annotations = False
        self.module_names = []
        self.file_info = None
        self.traversal_limited = False
        self.node_limited = False

    def diagnostic(self, code, message):
        if len(self.diagnostics) < MAX_DIAGNOSTICS:
            self.diagnostics.append({"code": code, "message": message})

    def add_site(self, site):
        if len(self.sites) >= MAX_SITES:
            if not self.site_limited:
                self.site_limited = True
                self.diagnostic("site-limit", "Site record limit reached; later sites were omitted.")
            return
        self.sites.append(site)

    def phase_for_scope(self, scope):
        current = scope
        while current is not None:
            if current.kind == "function":
                return "invocation"
            current = current.containing
        return "module-init"

    def evaluation_phase(self, phase):
        return "type" if self.is_stub else phase

    def annotation_phase(self):
        if self.is_stub:
            return "type"
        if self.future_annotations and sys.version_info >= (3, 7):
            return "type"
        return "unknown"

    def node_for(self, ast_node):
        return self.node_by_ast.get(id(ast_node))

    def add_node(self, ast_node, kind, name):
        if len(self.nodes) >= MAX_DECLARATION_NODES:
            if not self.node_limited:
                self.node_limited = True
                self.diagnostic("node-limit", "Declaration node limit reached; later nodes were omitted.")
            return None
        start, end = self.position.span(ast_node)
        node = NodeInfo(self, name, kind, start, end, ast_node)
        self.nodes.append(node)
        self.node_by_ast[id(ast_node)] = node
        return node

    def output(self):
        nodes = [self.init_node.record()]
        nodes.extend(node.record() for node in sorted(self.nodes, key=lambda item: (item.start, item.end, item.id)))
        sites = sorted(self.sites, key=lambda item: (item["start"], item["end"], item["relation"], item["name"]))
        return {"status": self.status, "nodes": nodes, "sites": sites, "diagnostics": self.diagnostics}

    @property
    def init_node(self):
        return NodeInfo(self, "<init>", "module-init", 0, self.position.length, None)


class AssignmentCollector(ast.NodeVisitor):
    def __init__(self, scope):
        self.scope = scope

    def visit_FunctionDef(self, node):
        return

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        return

    def visit_Lambda(self, node):
        return

    def visit_comprehension(self, node):
        return

    def mark_unknown_attribute(self, node):
        if not isinstance(node.value, ast.Name):
            return
        binding = self.scope.lookup(node.value.id)
        if binding is not None and binding.kind == "import":
            binding.unknown_attributes.add(node.attr)

    def visit_Attribute(self, node):
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.mark_unknown_attribute(node)
        self.generic_visit(node)

    def visit_Call(self, node):
        # Direct setattr(module_alias, "name", value) is another form of
        # module-attribute rebinding.  The call itself is not resolved here;
        # this only prevents a later attribute lookup from becoming a false
        # proof.
        if (isinstance(node.func, ast.Name) and node.func.id in ("setattr", "delattr")
                and len(node.args) >= 2 and isinstance(node.args[0], ast.Name)
                and isinstance(node.args[1], ast.Constant) and isinstance(node.args[1].value, str)):
            binding = self.scope.lookup(node.args[0].id)
            if binding is not None and binding.kind == "import":
                binding.unknown_attributes.add(node.args[1].value)
        elif (isinstance(node.func, ast.Name) and node.func.id in ("setattr", "delattr")
              and len(node.args) >= 2 and isinstance(node.args[0], ast.Name)):
            binding = self.scope.lookup(node.args[0].id)
            if binding is not None and binding.kind == "import":
                binding.unknown_attribute_writes = True
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.scope.add_unknown(node.id)

    def visit_ExceptHandler(self, node):
        if node.name:
            self.scope.add_unknown(node.name)
        for child in node.body:
            self.visit(child)

    def visit_MatchAs(self, node):
        if node.name:
            self.scope.add_unknown(node.name)
        if node.pattern:
            self.visit(node.pattern)

    def visit_MatchStar(self, node):
        if node.name:
            self.scope.add_unknown(node.name)

    def visit_MatchMapping(self, node):
        if node.rest:
            self.scope.add_unknown(node.rest)
        for pattern in node.patterns:
            self.visit(pattern)


def statement_children(node):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.stmt):
            yield child
        elif isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith) +
                        TRY_NODES + MATCH_NODES):
            yield child


def is_type_checking_test(node):
    if isinstance(node, ast.Name) and node.id == "TYPE_CHECKING":
        return True
    if isinstance(node, ast.Attribute) and node.attr == "TYPE_CHECKING":
        return isinstance(node.value, ast.Name) and node.value.id in ("typing", "t")
    return False


def branch_phase(test, phase, body):
    if phase == "type":
        return "type"
    if is_type_checking_test(test):
        return "type" if body else phase
    if (isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not)
            and is_type_checking_test(test.operand)):
        return phase if body else "type"
    return phase


def collect_declared_names(node):
    names = []
    class DeclarationVisitor(ast.NodeVisitor):
        def visit_FunctionDef(self, current):
            return

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, current):
            return

        def visit_Global(self, current):
            names.extend(("global", name) for name in current.names)

        def visit_Nonlocal(self, current):
            names.extend(("nonlocal", name) for name in current.names)

    visitor = DeclarationVisitor()
    for statement in node:
        visitor.visit(statement)
    return names


def parse_all_names(tree):
    result = set()
    for statement in tree.body:
        value = None
        if isinstance(statement, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "__all__" for target in statement.targets):
                value = statement.value
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name) and statement.target.id == "__all__":
            value = statement.value
        elif isinstance(statement, ast.AugAssign) and isinstance(statement.target, ast.Name) and statement.target.id == "__all__":
            value = statement.value
        if isinstance(value, (ast.List, ast.Tuple, ast.Set)):
            for item in value.elts:
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    result.add(item.value)
    return result


def build_scopes(document):
    root = Scope(document, "module", document.init_node)
    document.root_scope = root
    root.module_scope = root

    def make_child(scope, node, kind, name):
        info = document.add_node(node, kind, name)
        if info is None:
            return None
        info.scope = scope
        scope.add_definition(name, info)
        if kind == "class":
            parent_lookup = scope
        else:
            parent_lookup = scope.parent_lookup if scope.kind == "class" else scope
        child = Scope(document, "class" if kind == "class" else "function", info,
                      parent_lookup=parent_lookup, containing=scope)
        child.module_scope = root
        scope.children[id(node)] = child
        return child

    def predeclare(scope, body):
        for kind, name in collect_declared_names(body):
            if kind == "global":
                scope.global_names.add(name)
            else:
                scope.nonlocal_names.add(name)

    def collect(scope, body, type_context=False):
        predeclare(scope, body)
        for statement in body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                child = make_child(scope, statement, "function", statement.name)
                if child is not None:
                    args = statement.args
                    for arg in list(getattr(args, "posonlyargs", ())) + list(args.args) + list(args.kwonlyargs):
                        child.add_param(arg.arg)
                    if args.vararg:
                        child.add_param(args.vararg.arg)
                    if args.kwarg:
                        child.add_param(args.kwarg.arg)
                    collect(child, statement.body)
                continue
            if isinstance(statement, ast.ClassDef):
                child = make_child(scope, statement, "class", statement.name)
                if child is not None:
                    collect(child, statement.body)
                continue
            if isinstance(statement, ast.Import):
                for alias in statement.names:
                    binding_name = alias.asname or alias.name.split(".")[0]
                    record = ImportRecord(document, scope, statement, alias, "import", alias.name,
                                          binding_name, None, 0, type_context)
                    scope.import_records.append(record)
                    scope.add_import(binding_name, record)
                continue
            if isinstance(statement, ast.ImportFrom):
                if statement.module == "__future__":
                    if any(alias.name == "annotations" for alias in statement.names):
                        document.future_annotations = True
                    continue
                specifier = "." * statement.level + (statement.module or "")
                for alias in statement.names:
                    binding_name = alias.asname or alias.name
                    record = ImportRecord(document, scope, statement, alias, "from", specifier,
                                          binding_name, alias.name, statement.level, type_context)
                    scope.import_records.append(record)
                    if alias.name != "*":
                        scope.add_import(binding_name, record)
                continue

            AssignmentCollector(scope).visit(statement)
            if isinstance(statement, ast.If):
                body_type = type_context or is_type_checking_test(statement.test)
                else_type = type_context or (isinstance(statement.test, ast.UnaryOp)
                                              and isinstance(statement.test.op, ast.Not)
                                              and is_type_checking_test(statement.test.operand))
                collect(scope, statement.body, body_type)
                collect(scope, statement.orelse, else_type)
            elif isinstance(statement, (ast.For, ast.AsyncFor, ast.While)):
                collect(scope, statement.body, type_context)
                collect(scope, statement.orelse, type_context)
            elif isinstance(statement, (ast.With, ast.AsyncWith)):
                collect(scope, statement.body, type_context)
            elif isinstance(statement, TRY_NODES):
                collect(scope, statement.body, type_context)
                for handler in statement.handlers:
                    if handler.name:
                        scope.add_unknown(handler.name)
                    collect(scope, handler.body, type_context)
                collect(scope, statement.orelse, type_context)
                collect(scope, statement.finalbody, type_context)
            elif isinstance(statement, MATCH_NODES):
                for case in statement.cases:
                    collect(scope, case.body, type_context)

    collect(root, document.tree.body)
    document.nodes.sort(key=lambda item: (item.start, item.end, item.id))


def add_refs_to_binding(binding, refs, status, reason):
    binding.refs = unique_refs(refs)
    binding.status = status
    binding.reason = reason


def available_import_records(binding, phase):
    if phase == "type":
        return binding.imports
    return [record for record in binding.imports if not record.type_context]


def import_resolution(records, unavailable_reason=""):
    if not records:
        return "unresolved", [], unavailable_reason or "binding is only available during type checking"
    refs = unique_refs(ref for record in records for ref in record.refs)
    statuses = {record.status for record in records}
    if len(refs) > 1:
        status = "ambiguous"
    elif len(refs) == 1 and statuses == {"resolved"}:
        status = "resolved"
    elif "ambiguous" in statuses:
        status = "ambiguous"
    elif "external" in statuses and not ("unresolved" in statuses or "unsupported" in statuses):
        status = "external"
    elif "unsupported" in statuses:
        status = "unsupported"
    else:
        status = "unresolved"
    reason = "; ".join(record.reason for record in records if record.reason)[:240]
    return status, refs, reason


def export_refs(document, name, phase="unknown", seen=None):
    if seen is None:
        seen = set()
    marker = (document.key, name, phase)
    if marker in seen:
        return []
    seen.add(marker)
    if document.root_scope is None:
        return []
    binding = document.root_scope.bindings.get(name)
    if binding is None:
        return []
    if binding.kind == "def" and binding.node is not None:
        return [Ref(document, binding.node)]
    if binding.kind == "import":
        refs = []
        for record in available_import_records(binding, phase):
            refs.extend(record.refs)
        return unique_refs(refs)
    if binding.kind == "ambiguous":
        return unique_refs(binding.refs)
    return []


def relative_module_names(document, level, module):
    if level == 0:
        return [tuple(part for part in (module or "").split(".") if part)]
    module_parts_for_file = document.module_names
    result = []
    is_package_init = clean_path(document.key).endswith("/__init__.py") or clean_path(document.key).endswith("/__init__.pyi")
    for current in module_parts_for_file:
        package = current if is_package_init else current[:-1]
        trim = max(0, level - 1)
        # A multi-dot relative import cannot walk above the containing
        # package.  Do not clamp that base to the repository root: that would
        # turn ``from ..x`` in a top-level module into a false import of ``x``.
        if level > 1 and trim >= len(package):
            continue
        base = package[:max(0, len(package) - trim)]
        result.append(tuple(base + tuple(part for part in (module or "").split(".") if part)))
    return result


def candidate_modules(index, names):
    refs = []
    for name in names:
        for file_info in index.get(tuple(name), []):
            refs.append(Ref(file_info))
    return unique_refs(refs)


def update_binding(binding):
    if binding.kind != "import":
        return
    binding.status, binding.refs, binding.reason = import_resolution(binding.imports)


def refresh_bindings(scope):
    for binding in scope.bindings.values():
        update_binding(binding)
    for child in scope.children.values():
        refresh_bindings(child)


def resolve_import_record(record, index):
    document = record.document
    if record.kind == "import":
        names = [(tuple(part for part in record.specifier.split(".") if part))]
        record.base_module_names = names
        refs = candidate_modules(index, names)
        if refs:
            record.status = "resolved" if len(refs) == 1 else "ambiguous"
            record.refs = refs
            record.reason = "multiple supplied module candidates" if len(refs) > 1 else ""
        else:
            record.status = "external"
            record.refs = []
            record.reason = "module is outside the supplied source files"
        return

    names = relative_module_names(document, record.level, record.specifier.lstrip("."))
    record.base_module_names = names
    base_refs = candidate_modules(index, names)
    if record.imported_name == "*":
        record.status = "unsupported"
        record.refs = base_refs
        record.reason = "wildcard import does not expose a statically safe binding"
        return

    symbol_refs = []
    for ref in base_refs:
        if ref.node is None:
            symbol_refs.extend(export_refs(ref.file, record.imported_name, record.phase))
    symbol_refs = unique_refs(symbol_refs)
    if symbol_refs:
        record.status = "resolved" if len(symbol_refs) == 1 else "ambiguous"
        record.refs = symbol_refs
        record.reason = "multiple supplied symbol candidates" if len(symbol_refs) > 1 else ""
        return

    submodule_names = []
    for name in names:
        submodule_names.append(tuple(name) + tuple(record.imported_name.split(".")))
    submodule_refs = candidate_modules(index, submodule_names)
    if submodule_refs:
        record.status = "resolved" if len(submodule_refs) == 1 else "ambiguous"
        record.refs = submodule_refs
        record.reason = "multiple supplied submodule candidates" if len(submodule_refs) > 1 else ""
        return

    if base_refs:
        record.status = "unresolved" if len(base_refs) == 1 else "ambiguous"
        record.refs = base_refs
        record.reason = "imported name is not a proven supplied symbol"
    else:
        record.status = "unresolved" if record.level else "external"
        record.refs = []
        record.reason = "relative module is not supplied" if record.level else "module is outside the supplied source files"


def build_module_index(documents, roots):
    index = {}
    for document in documents:
        path = clean_path(document.key)
        if not (path.endswith(".py") or path.endswith(".pyi")):
            continue
        candidates = []
        for root in roots:
            root = clean_path(root)
            if root and (path == root or not path.startswith(root + "/")):
                continue
            relative = path[len(root):].lstrip("/") if root else path
            parts = list(module_parts(relative))
            if relative.endswith("/__init__.py") or relative.endswith("/__init__.pyi"):
                parts = parts[:-1]
            if parts:
                candidates.append(tuple(parts))
        document.module_names = list(dict.fromkeys(candidates))
        for name in document.module_names:
            index.setdefault(name, []).append(document.file_info)
    return index


def resolve_all_imports(documents, index):
    for _ in range(max(2, len(documents) + 1)):
        before = [(record.status, tuple(ref_key(ref) for ref in record.refs), record.reason)
                  for document in documents for record in all_import_records(document)]
        for document in documents:
            for record in all_import_records(document):
                resolve_import_record(record, index)
        for document in documents:
            refresh_bindings(document.root_scope)
        after = [(record.status, tuple(ref_key(ref) for ref in record.refs), record.reason)
                 for document in documents for record in all_import_records(document)]
        if before == after:
            break


def all_import_records(document):
    result = []
    def visit(scope):
        result.extend(scope.import_records)
        for child in scope.children.values():
            visit(child)
    visit(document.root_scope)
    return result


def resolution_for_binding(scope, name, shadowed=None, phase="unknown"):
    if shadowed and name in shadowed:
        return "unresolved", [], "comprehension or local iteration target shadows the name"
    binding = scope.lookup(name)
    if binding is None:
        return "unresolved", [], "name is not statically bound"
    if binding.kind == "def":
        return "resolved", [Ref(scope.document, binding.node)], ""
    if binding.kind == "param":
        return "unresolved", [], binding.reason
    if binding.kind == "unknown":
        return "unresolved", [], binding.reason or "local name is rebound"
    if binding.kind == "ambiguous":
        return "ambiguous", binding.refs, binding.reason or "multiple local bindings"
    if binding.kind == "import":
        return import_resolution(available_import_records(binding, phase))
    return "unresolved", [], "unsupported binding"


def site_base(scope, relation, name, node, phase):
    start, end = scope.document.position.span(node)
    return {"owner": scope.owner.id, "relation": relation, "name": name,
            "start": start, "end": end, "phase": phase}


def add_resolution(site, status, refs, reason, require_node=False):
    if status == "resolved" and len(refs) == 1:
        ref = refs[0]
        if require_node and ref.node is None:
            site["resolution"] = "unresolved"
            site["reason"] = reason or "target is only a module; callable node was not proven"
            return
        site["resolution"] = "resolved"
        site["target"] = ref.candidate()
    elif status == "ambiguous":
        site["resolution"] = "ambiguous"
        if refs:
            site["candidates"] = [ref.candidate() for ref in refs]
        if reason:
            site["reason"] = reason
    elif status == "external":
        site["resolution"] = "external"
        if reason:
            site["reason"] = reason
    elif status == "unsupported":
        site["resolution"] = "unsupported"
        if reason:
            site["reason"] = reason
    else:
        site["resolution"] = "unresolved"
        if refs:
            site["candidates"] = [ref.candidate() for ref in refs]
        if reason:
            site["reason"] = reason


def attribute_text(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = attribute_text(node.value)
        return (prefix + "." if prefix else "") + node.attr
    return "<expression>"


class ExpressionVisitor(ast.NodeVisitor):
    def __init__(self, analyzer, scope, phase, shadowed=None, record_names=False):
        self.analyzer = analyzer
        self.scope = scope
        self.phase = phase
        self.shadowed = set(shadowed or ())
        self.record_names = record_names

    def with_phase(self, phase, record_names=None):
        if record_names is None:
            record_names = self.record_names
        return ExpressionVisitor(self.analyzer, self.scope, phase, self.shadowed, record_names)

    def branch_phase(self, test, body):
        return branch_phase(test, self.phase, body)

    def visit_If(self, node):
        self.visit(node.test)
        body_visitor = self.with_phase(self.branch_phase(node.test, True))
        for statement in node.body:
            body_visitor.visit(statement)
        else_visitor = self.with_phase(self.branch_phase(node.test, False))
        for statement in node.orelse:
            else_visitor.visit(statement)

    def visit_Name(self, node):
        if self.record_names:
            self.analyzer.add_reference(self.scope, node, self.phase, self.shadowed)

    def visit_FunctionDef(self, node):
        return

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        return

    def visit_Import(self, node):
        return

    def visit_ImportFrom(self, node):
        return

    def visit_Lambda(self, node):
        # Lambda defaults are evaluated now; its body has no snapshot node, so
        # do not manufacture an invocation edge for a body that may never run.
        self.scope.document.diagnostic(
            "lambda-body-unresolved",
            "Lambda body dependencies were omitted because no callable node is emitted for lambdas."
        )
        for default in list(node.args.defaults) + [item for item in node.args.kw_defaults if item is not None]:
            self.visit(default)

    def visit_AnnAssign(self, node):
        self.visit(node.target)
        if node.value is not None:
            self.visit(node.value)
        self.with_phase(self.scope.document.annotation_phase(), True).visit(node.annotation)

    def visit_Call(self, node):
        dynamic_name = self.analyzer.dynamic_import_name(node.func, self.scope, self.phase)
        if dynamic_name is not None:
            site = site_base(self.scope, "import", dynamic_name, node, self.phase)
            site["loading"] = "eager"
            literal = self.analyzer.literal_string(node.args[0]) if node.args else None
            if literal is not None:
                site["specifier"] = literal
            add_resolution(site, "unsupported", [], "dynamic import cannot be resolved without executing code")
            self.scope.document.add_site(site)
        else:
            if isinstance(node.func, ast.Name):
                name = node.func.id
                status, refs, reason = resolution_for_binding(self.scope, name, self.shadowed, self.phase)
                relation = "construct" if self.analyzer.binding_is_class(refs, status) else "call"
                site = site_base(self.scope, relation, name, node, self.phase)
                add_resolution(site, status, refs, reason, require_node=True)
                self.scope.document.add_site(site)
            elif isinstance(node.func, ast.Attribute):
                site = site_base(self.scope, "call", attribute_text(node.func), node, self.phase)
                resolved = self.analyzer.resolve_module_attribute(self.scope, node.func, self.phase, self.shadowed)
                if resolved is None:
                    add_resolution(site, "unsupported", [], "attribute or method dispatch is not proven statically")
                else:
                    status, refs, reason = resolved
                    relation = "construct" if self.analyzer.binding_is_class(refs, status) else "call"
                    site["relation"] = relation
                    add_resolution(site, status, refs, reason, require_node=True)
                self.scope.document.add_site(site)
                self.visit(node.func.value)
            else:
                site = site_base(self.scope, "call", "<indirect>", node, self.phase)
                add_resolution(site, "unsupported", [], "indirect callable expression is not resolved")
                self.scope.document.add_site(site)
                self.visit(node.func)

        for argument in node.args:
            if isinstance(argument, ast.Starred):
                value = argument.value
            else:
                value = argument
            if dynamic_name is not None:
                self.visit(value)
            else:
                self.visit_argument_value(value)
        for keyword in node.keywords:
            if dynamic_name is not None:
                self.visit(keyword.value)
            else:
                self.visit_argument_value(keyword.value)

    def visit_argument_value(self, node):
        if isinstance(node, ast.Name):
            self.analyzer.add_reference(self.scope, node, self.phase, self.shadowed)
        elif isinstance(node, ast.Attribute):
            site = site_base(self.scope, "reference", attribute_text(node), node, self.phase)
            resolved = self.analyzer.resolve_module_attribute(self.scope, node, self.phase, self.shadowed)
            if resolved is None:
                add_resolution(site, "unsupported", [], "attribute reference or dispatch is not proven statically")
            else:
                add_resolution(site, resolved[0], resolved[1], resolved[2], require_node=True)
            self.scope.document.add_site(site)
            self.visit(node.value)
        else:
            self.visit(node)

    def _visit_comprehension(self, node, element_names):
        visitor = ExpressionVisitor(self.analyzer, self.scope, self.phase, self.shadowed)
        for generator in node.generators:
            visitor.visit(generator.iter)
            names = self.analyzer.assignment_names(generator.target)
            visitor.shadowed.update(names)
            for condition in generator.ifs:
                visitor.visit(condition)
        visitor.shadowed.update(element_names)
        if hasattr(node, "elt"):
            visitor.visit(node.elt)
        if hasattr(node, "key"):
            visitor.visit(node.key)
        if hasattr(node, "value"):
            visitor.visit(node.value)

    def visit_ListComp(self, node):
        self._visit_comprehension(node, set())

    visit_SetComp = visit_ListComp

    def visit_GeneratorExp(self, node):
        if not node.generators:
            return
        first = node.generators[0]
        # The outermost iterator is evaluated while constructing the generator
        # expression.  Its filters and all later iterators/body expressions are
        # deferred until iteration; inside a function that is invocation work,
        # while module-level deferral has no safe invocation owner.
        self.visit(first.iter)
        deferred_phase = "type" if self.phase == "type" else (
            "invocation" if self.phase == "invocation" else "unknown"
        )
        deferred = ExpressionVisitor(self.analyzer, self.scope, deferred_phase, self.shadowed, self.record_names)
        deferred.shadowed.update(self.analyzer.assignment_names(first.target))
        for condition in first.ifs:
            deferred.visit(condition)
        for generator in node.generators[1:]:
            deferred.visit(generator.iter)
            deferred.shadowed.update(self.analyzer.assignment_names(generator.target))
            for condition in generator.ifs:
                deferred.visit(condition)
        if hasattr(node, "elt"):
            deferred.visit(node.elt)

    def visit_DictComp(self, node):
        self._visit_comprehension(node, set())


class Analyzer:
    def __init__(self, documents):
        self.documents = documents

    @staticmethod
    def literal_string(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        return None

    @staticmethod
    def assignment_names(node):
        result = set()
        for current in ast.walk(node):
            if isinstance(current, ast.Name) and isinstance(current.ctx, (ast.Store, ast.Del)):
                result.add(current.id)
        return result

    def binding_is_class(self, refs, status):
        return status == "resolved" and len(refs) == 1 and refs[0].node is not None and refs[0].node.kind == "class"

    def dynamic_import_name(self, node, scope, phase):
        if isinstance(node, ast.Name) and node.id == "__import__":
            binding = scope.lookup(node.id)
            # The builtin is only a dynamic import when it has not been
            # shadowed by a local/parameter/global binding.
            return "__import__" if binding is None else None
        if isinstance(node, ast.Attribute) and node.attr == "import_module" and isinstance(node.value, ast.Name) and node.value.id == "importlib":
            binding = scope.lookup("importlib")
            if binding is None:
                return "importlib.import_module"
            records = available_import_records(binding, phase) if binding.kind == "import" else []
            if (len(records) == 1 and records[0].kind == "import"
                    and records[0].specifier == "importlib"
                    and not binding.unknown_attribute_writes
                    and "import_module" not in binding.unknown_attributes
                    and records[0].status == "external"):
                return "importlib.import_module"
            return None
        if isinstance(node, ast.Name):
            binding = scope.lookup(node.id)
            if binding is not None and binding.kind == "import":
                records = available_import_records(binding, phase)
                if (len(records) == 1 and records[0].kind == "from"
                        and records[0].specifier == "importlib"
                        and records[0].imported_name == "import_module"
                        and records[0].status == "external"):
                    return node.id
        return None

    def resolve_module_attribute(self, scope, node, phase, shadowed=None):
        if not isinstance(node, ast.Attribute) or not isinstance(node.value, ast.Name):
            return None
        binding = scope.lookup(node.value.id)
        if (binding is None or binding.kind != "import" or binding.unknown_attribute_writes
                or node.attr in binding.unknown_attributes):
            return None
        status, refs, _ = resolution_for_binding(scope, node.value.id, shadowed, phase)
        if status != "resolved" or len(refs) != 1 or refs[0].node is not None:
            return None
        module = refs[0].file
        symbol_refs = export_refs(module, node.attr, phase)
        if not symbol_refs:
            # Missing attributes can be supplied dynamically by module-level
            # __getattr__ or another runtime mechanism; retain unsupported
            # rather than guessing a target.
            return None
        if len(symbol_refs) == 1:
            return "resolved", symbol_refs, ""
        return "ambiguous", symbol_refs, "multiple supplied module attribute candidates"

    def add_reference(self, scope, node, phase, shadowed=None):
        status, refs, reason = resolution_for_binding(scope, node.id, shadowed, phase)
        site = site_base(scope, "reference", node.id, node, phase)
        add_resolution(site, status, refs, reason, require_node=True)
        scope.document.add_site(site)

    def add_decorator_application(self, scope, decorator, phase):
        callee = decorator.func if isinstance(decorator, ast.Call) else decorator
        name = attribute_text(callee)
        site = site_base(scope, "call", name, decorator, phase)
        if isinstance(decorator, ast.Call):
            # The factory call is recorded by ExpressionVisitor.  Its return
            # value is a separate callable whose identity is not proven by
            # source lookup, so do not reuse the factory target here.
            add_resolution(site, "unsupported", [], "decorator factory result is not statically resolved")
        elif isinstance(callee, ast.Name):
            status, refs, reason = resolution_for_binding(scope, callee.id, phase=phase)
            add_resolution(site, status, refs, reason, require_node=True)
        elif isinstance(callee, ast.Attribute):
            resolved = self.resolve_module_attribute(scope, callee, phase)
            if resolved is None:
                add_resolution(site, "unsupported", [], "decorator attribute dispatch is not proven statically")
            else:
                add_resolution(site, resolved[0], resolved[1], resolved[2], require_node=True)
        else:
            add_resolution(site, "unsupported", [], "indirect decorator expression is not resolved")
        scope.document.add_site(site)

    def visit_header(self, scope, node, phase):
        visitor = ExpressionVisitor(self, scope, scope.document.evaluation_phase(phase))
        for decorator in node.decorator_list:
            visitor.visit(decorator)
            self.add_decorator_application(scope, decorator, visitor.phase)
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                visitor.visit(base)
            for keyword in node.keywords:
                visitor.visit(keyword.value)
            return
        args = node.args
        for default in list(args.defaults) + [item for item in args.kw_defaults if item is not None]:
            visitor.visit(default)
        for annotation in self.function_annotations(node):
            visitor.with_phase(scope.document.annotation_phase(), True).visit(annotation)
        if getattr(node, "type_comment", None):
            scope.document.diagnostic("type-comment-unresolved", "Type comments are retained as unknown-phase syntax.")

    @staticmethod
    def function_annotations(node):
        annotations = []
        for arg in list(getattr(node.args, "posonlyargs", ())) + list(node.args.args) + list(node.args.kwonlyargs):
            if arg.annotation is not None:
                annotations.append(arg.annotation)
        if node.args.vararg and node.args.vararg.annotation is not None:
            annotations.append(node.args.vararg.annotation)
        if node.args.kwarg and node.args.kwarg.annotation is not None:
            annotations.append(node.args.kwarg.annotation)
        if node.returns is not None:
            annotations.append(node.returns)
        return annotations

    def analyze_definition(self, scope, node, phase):
        self.visit_header(scope, node, phase)
        child = scope.children.get(id(node))
        if child is None:
            return
        if isinstance(node, ast.ClassDef):
            self.analyze_scope(child, node.body, phase)
        else:
            self.analyze_scope(child, node.body, "invocation")

    def analyze_nested_definitions(self, node, scope, phase):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            self.analyze_definition(scope, node, phase)
            return
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.expr) and isinstance(child, ast.Lambda):
                continue
            child_phase = phase
            if isinstance(node, ast.If):
                if child in node.body:
                    child_phase = branch_phase(node.test, phase, True)
                elif child in node.orelse:
                    child_phase = branch_phase(node.test, phase, False)
            self.analyze_nested_definitions(child, scope, child_phase)

    def analyze_import_sites(self, document):
        for record in sorted(all_import_records(document), key=lambda item: (item.site_start, item.site_end, item.binding_name)):
            site = {"owner": record.owner.id,
                    "relation": "reexport" if record.kind == "from" and record.scope.kind == "module" and record.binding_name in document.all_names else "import",
                    "name": record.binding_name,
                    "start": record.site_start, "end": record.site_end,
                    "phase": record.phase, "resolution": record.status,
                    "specifier": record.specifier, "loading": "eager"}
            if record.status in ("resolved", "ambiguous"):
                if record.status == "resolved" and len(record.refs) == 1:
                    site["target"] = record.refs[0].candidate()
                elif record.refs:
                    site["candidates"] = [ref.candidate() for ref in record.refs]
            elif record.refs:
                site["candidates"] = [ref.candidate() for ref in record.refs]
            if record.reason:
                site["reason"] = record.reason
            document.add_site(site)

    def analyze_scope(self, scope, body, phase):
        evaluation_phase = scope.document.evaluation_phase(phase)
        for statement in body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.analyze_nested_definitions(statement, scope, phase)
                continue
            if isinstance(statement, (ast.Import, ast.ImportFrom)):
                continue
            ExpressionVisitor(self, scope, evaluation_phase).visit(statement)
            self.analyze_nested_definitions(statement, scope, phase)

    def analyze_document(self, document):
        self.analyze_import_sites(document)
        self.analyze_scope(document.root_scope, document.tree.body, "module-init")


def parse_document(document):
    try:
        document.tree = ast.parse(document.text, filename=document.key, type_comments=True)
        count = 0
        for _ in ast.walk(document.tree):
            count += 1
            if count > MAX_AST_NODES:
                break
        if count > MAX_AST_NODES:
            document.traversal_limited = True
            document.diagnostic("ast-limit", "AST traversal limit reached; document evidence is incomplete.")
            document.root_scope = Scope(document, "module", document.init_node)
            document.root_scope.module_scope = document.root_scope
        else:
            document.all_names = parse_all_names(document.tree)
            build_scopes(document)
    except SyntaxError as error:
        document.status = "invalid"
        line = getattr(error, "lineno", None)
        column = getattr(error, "offset", None)
        start = document.position.syntax_position(line, max(0, (column or 1) - 1)) if line else None
        message = "SyntaxError: " + str(error)
        if start is not None:
            message += " (offset " + str(start) + ")"
        document.diagnostic("syntax-error", message)
    except (RecursionError, MemoryError, ValueError) as error:
        document.status = "invalid"
        document.diagnostic("parse-error", type(error).__name__ + ": " + str(error))


def load_input():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("input must be a JSON object")
    files = payload.get("files", {})
    if not isinstance(files, dict):
        raise ValueError("files must be an object")
    roots = payload.get("pythonRoots", None)
    if roots is None:
        roots = ["", "src"]
    if not isinstance(roots, list) or not all(isinstance(root, str) for root in roots):
        raise ValueError("pythonRoots must be an array of strings")
    return files, roots


def main():
    files, roots = load_input()
    documents = []
    for key, text in files.items():
        if not isinstance(key, str) or not isinstance(text, str):
            raise ValueError("files must map string paths to string source")
        document = Document(key, text)
        document.file_info = document
        documents.append(document)
        parse_document(document)

    valid = [document for document in documents if document.tree is not None and document.root_scope is not None]
    index = build_module_index(documents, [clean_path(root) for root in roots])
    if valid:
        resolve_all_imports(valid, index)
        analyzer = Analyzer(valid)
        for document in valid:
            if document.traversal_limited:
                continue
            try:
                analyzer.analyze_document(document)
            except (RecursionError, MemoryError, ValueError) as error:
                document.status = "invalid"
                document.diagnostic("analysis-error", type(error).__name__ + ": " + str(error))
                document.sites = []

    output_documents = {}
    for document in documents:
        output_documents[document.key] = document.output()
    producer = "bygone-python-ast/" + sys.version.split()[0]
    json.dump({"producer": producer, "documents": output_documents}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        # Keep stdout JSON-shaped for CLI callers even for malformed requests.
        json.dump({"producer": "bygone-python-ast/" + sys.version.split()[0], "documents": {}}, sys.stdout)
        sys.stdout.write("\n")
