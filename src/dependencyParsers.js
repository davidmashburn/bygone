/* global require, __dirname, Buffer, module */
'use strict';

// This parser is deliberately independent of the TypeScript dependency graph.
// It consumes source snapshots, never executes target code, and only uses the
// bundled Tree-sitter grammars plus metadata supplied in `files`.
const path = require('node:path');
const { loadLanguage } = require('../packages/strand/src/tree-sitter-frontend');
const { languageFor, TREE_SITTER_LANGUAGES } = require('../packages/strand/src/languages');

// The workspace normally resolves this from the root node_modules directory.
// A packaged checkout may instead retain the Strand workspace dependency next
// to its source. The first lookup is intentionally computed so esbuild can
// bundle the public module-path lookup while source tests can use either layout.
let Parser;
try {
    ({ Parser } = require(path.join(__dirname, '../packages/strand/node_modules/web-tree-sitter')));
} catch {
    ({ Parser } = require('web-tree-sitter'));
}

const PRODUCER_GRAMMARS = ['go', 'rust', 'mojo'].map(language => {
    const grammar = TREE_SITTER_LANGUAGES[language];
    return `${language}@${grammar.version}#${grammar.sha256}`;
}).join('; ');
const PRODUCER = `bygone-dependency-parsers@1 (web-tree-sitter@0.27.1; ${PRODUCER_GRAMMARS})`;
const SUPPORTED = new Set(['go', 'rust', 'mojo']);
const MAX_FILES = 2000;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 20000;
const MAX_TRAVERSAL_NODES = 20000;
const MAX_DIAGNOSTICS = 1000;

const EMPTY_SET = Object.freeze(new Set());

function field(node, name) {
    try { return node?.childForFieldName(name) || null; } catch { return null; }
}

function fields(node, name) {
    try {
        if (typeof node?.childrenForFieldName === 'function') return [...node.childrenForFieldName(name)];
    } catch { /* Older web-tree-sitter builds may not expose repeated fields. */ }
    const child = field(node, name);
    return child ? [child] : [];
}

function namedChildren(node) {
    return node?.namedChildren ? [...node.namedChildren] : [];
}

function textOf(node) {
    return typeof node?.text === 'string' ? node.text : '';
}

function nodeKey(node) {
    return node ? `${node.startIndex}:${node.endIndex}:${node.type}` : '';
}

function normalizeFile(file) {
    return String(file).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function dirname(file) {
    const value = path.posix.dirname(normalizeFile(file));
    return value === '' ? '.' : value;
}

function joinPath(...parts) {
    const value = path.posix.normalize(parts.filter(Boolean).join('/')).replace(/^\.\//, '');
    return value === '' ? '.' : value;
}

function isUnder(file, directory) {
    const current = normalizeFile(file);
    const root = normalizeFile(directory);
    return root === '.' ? !current.startsWith('../') : current === root || current.startsWith(root + '/');
}

function decodeQuoted(text) {
    const value = String(text || '').trim();
    if (value.length >= 2 && value[0] === '`' && value[value.length - 1] === '`') return value.slice(1, -1);
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
        try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    return value;
}

function nodeSpan(context, node) {
    // web-tree-sitter exposes indices into the JavaScript source string. Those
    // indices are already UTF-16 code-unit offsets, including for astral and
    // non-ASCII characters; applying a byte map here would shift later nodes.
    const start = Math.max(0, Math.min(context.source.length, Number(node?.startIndex) || 0));
    const end = Math.max(start, Math.min(context.source.length, Number(node?.endIndex) || start));
    return { start, end };
}

function addDiagnostic(context, code, message) {
    if (context.diagnostics.some(item => item.code === code && item.message === message)) return;
    if (context.diagnostics.length < MAX_DIAGNOSTICS) context.diagnostics.push({ code, message });
}

function consumeTraversal(context) {
    context.traversed += 1;
    if (context.traversed <= MAX_TRAVERSAL_NODES) return true;
    context.truncated = true;
    return false;
}

function addRecord(context) {
    if (context.records < MAX_RECORDS) {
        context.records += 1;
        return true;
    }
    context.truncated = true;
    return false;
}

function walk(context, root, visit) {
    if (!root || context.truncated) return;
    const stack = [{ node: root, ancestors: [] }];
    while (stack.length && !context.truncated) {
        const current = stack.pop();
        if (!consumeTraversal(context)) break;
        const descend = visit(current.node, current.ancestors) !== false;
        if (!descend || context.truncated) continue;
        const children = namedChildren(current.node);
        const ancestors = [...current.ancestors, current.node];
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push({ node: children[index], ancestors });
        }
    }
}

function ancestorOfType(ancestors, types) {
    const wanted = types instanceof Set ? types : new Set(types);
    for (let index = ancestors.length - 1; index >= 0; index--) {
        if (wanted.has(ancestors[index].type)) return ancestors[index];
    }
    return null;
}

function hasAncestorType(ancestors, types) {
    return Boolean(ancestorOfType(ancestors, types));
}

function nodeContains(parent, child) {
    return Boolean(parent && child && child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex);
}

function goReceiverType(receiver) {
    const declaration = fields(receiver, 'name').length === 1 ? receiver : namedChildren(receiver).find(child => child.type === 'parameter_declaration');
    const parameter = declaration?.type === 'parameter_declaration' ? declaration : namedChildren(receiver).find(child => child.type === 'parameter_declaration');
    let type = field(parameter, 'type');
    if (!type) return null;
    while (type?.type === 'pointer_type') {
        const children = namedChildren(type);
        if (children.length !== 1) return null;
        type = children[0];
    }
    if (type?.type === 'type_identifier') return textOf(type);
    if (type?.type === 'generic_type') {
        const base = field(type, 'type');
        return base?.type === 'type_identifier' ? textOf(base) : null;
    }
    return null;
}

function rustImplName(node) {
    const type = textOf(field(node, 'type')).replace(/\s+/gu, ' ').trim();
    const trait = textOf(field(node, 'trait')).replace(/\s+/gu, ' ').trim();
    if (trait && type) return `impl ${trait} for ${type}`;
    if (type) return `impl ${type}`;
    if (trait) return `impl ${trait}`;
    return null;
}

function nearestRustImpl(ancestors) {
    for (let index = ancestors.length - 1; index >= 0; index--) {
        const node = ancestors[index];
        if (node.type === 'impl_item') return rustImplName(node) || 'impl';
        if (node.type === 'trait_item') {
            const name = field(node, 'name');
            return name ? `trait ${textOf(name)}` : 'trait';
        }
    }
    return null;
}

function nearestMojoClass(ancestors, context) {
    for (let index = ancestors.length - 1; index >= 0; index--) {
        const entry = context.declarationByKey.get(nodeKey(ancestors[index]));
        if (entry?.kind === 'class') return entry;
    }
    return null;
}

function declarationDescription(language, node, ancestors, context) {
    if (language === 'go') {
        if (node.type === 'function_declaration') {
            const name = field(node, 'name');
            return name ? { nameNode: name, name: textOf(name), kind: 'function', callable: true } : null;
        }
        if (node.type === 'method_declaration') {
            const name = field(node, 'name');
            const receiver = goReceiverType(field(node, 'receiver'));
            return name && receiver ? { nameNode: name, name: `${receiver}.${textOf(name)}`, baseName: textOf(name), kind: 'function', callable: true, method: true } : null;
        }
        if ((node.type === 'type_spec' || node.type === 'type_alias') && !hasAncestorType(ancestors, new Set(['function_declaration', 'method_declaration']))) {
            const name = field(node, 'name');
            return name ? { nameNode: name, name: textOf(name), kind: 'class', callable: true } : null;
        }
        return null;
    }

    if (language === 'rust') {
        if (node.type === 'function_item' || node.type === 'function_signature_item') {
            const name = field(node, 'name');
            if (!name) return null;
            const impl = nearestRustImpl(ancestors);
            const baseName = textOf(name);
            return { nameNode: name, name: impl ? `${impl}::${baseName}` : baseName, baseName,
                kind: 'function', callable: true, method: Boolean(impl), signatureOnly: node.type === 'function_signature_item' };
        }
        if (['struct_item', 'enum_item', 'union_item', 'trait_item', 'type_item'].includes(node.type)) {
            const name = field(node, 'name');
            return name ? { nameNode: name, name: textOf(name), kind: 'class', callable: true } : null;
        }
        return null;
    }

    if (language === 'mojo') {
        if (node.type === 'function_definition') {
            const name = field(node, 'name');
            if (!name) return null;
            const parentClass = nearestMojoClass(ancestors, context);
            const baseName = textOf(name);
            return { nameNode: name, name: parentClass ? `${parentClass.name}.${baseName}` : baseName, baseName,
                kind: 'function', callable: true, method: Boolean(parentClass) };
        }
        if (['class_definition', 'trait_definition', 'enum_definition'].includes(node.type)) {
            const name = field(node, 'name');
            return name ? { nameNode: name, name: textOf(name), kind: 'class', callable: true } : null;
        }
    }
    return null;
}

function createContext(file, source, language) {
    const context = {
        file, normalizedFile: normalizeFile(file), source, language,
        records: 0, traversed: 0, truncated: false,
        diagnostics: [], nodes: [], sites: [], declarations: [], declarationByKey: new Map(),
        wrapperOwnerByKey: new Map(), nameNodeKeys: new Set(), bindingCache: new Map(),
        importBindings: new Map(), rustModules: new Map(), rustModulePaths: [], rustModulePath: null, goImports: new Map(),
        rootNode: null, tree: null, parser: null
    };
    if (addRecord(context)) {
        const id = '<init>';
        context.init = { id, file, name: '<init>', kind: 'module-init', start: 0, end: source.length,
            baseName: '<init>', callable: false, ast: null };
        context.nodes.push({ id, name: '<init>', kind: 'module-init', start: 0, end: source.length });
    }
    return context;
}

function scopePathForAncestors(language, ancestors) {
    if (language === 'go') return [];
    const pathParts = [];
    for (const ancestor of ancestors) {
        if (language === 'rust') {
            if (ancestor.type === 'mod_item' || ancestor.type === 'function_item' || ancestor.type === 'function_signature_item') {
                const name = field(ancestor, 'name');
                if (name) pathParts.push(textOf(name));
            } else if (ancestor.type === 'impl_item') {
                const name = rustImplName(ancestor);
                if (name) pathParts.push(name);
            } else if (ancestor.type === 'trait_item') {
                const name = field(ancestor, 'name');
                if (name) pathParts.push(`trait ${textOf(name)}`);
            }
        } else if (language === 'mojo') {
            if (ancestor.type === 'class_definition') {
                const name = field(ancestor, 'name');
                if (name) pathParts.push(textOf(name));
            } else if (ancestor.type === 'function_definition') {
                const name = field(ancestor, 'name');
                if (name) pathParts.push(textOf(name));
            }
        }
    }
    return pathParts;
}

function rustModulePathForAncestors(ancestors) {
    const pathParts = [];
    for (const ancestor of ancestors) {
        if (ancestor.type !== 'mod_item') continue;
        const name = field(ancestor, 'name');
        if (name) pathParts.push(textOf(name));
    }
    return pathParts;
}

function rustVisibility(node) {
    const visibility = namedChildren(node).find(child => child.type === 'visibility_modifier');
    if (!visibility) return 'private';
    const value = textOf(visibility).replace(/\s+/gu, ' ').trim();
    const compact = value.replace(/\s/gu, '');
    if (compact === 'pub' || compact === 'pub(crate)') return 'public';
    if (compact === 'pub(super)') return 'super';
    if (/^pub\s*\(\s*in\b/u.test(value)) {
        const match = /^pub\s*\(\s*in\s+([^)]+)\)$/u.exec(value);
        const path = match?.[1].split('::').map(part => part.trim());
        if (!path?.length || path.some(part => !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(part))) return { kind: 'unknown' };
        return { kind: 'restricted', path };
    }
    return 'private';
}

function samePath(left, right) {
    return left.length === right.length && left.every((part, index) => part === right[index]);
}

function pathStartsWith(pathValue, prefix) {
    return prefix.length <= pathValue.length && prefix.every((part, index) => part === pathValue[index]);
}

function rustPathForContext(context, modulePath, callerContext) {
    if (Array.isArray(context.rustModulePath)) return [...context.rustModulePath, ...modulePath];
    if (context === callerContext) return [...modulePath];
    return null;
}

function rustVisibilityAllows(visibility, definitionPath, callerPath) {
    if (visibility === 'public') return true;
    if (!Array.isArray(definitionPath) || !Array.isArray(callerPath)) return false;
    let visibleFrom;
    if (visibility === 'super') {
        visibleFrom = definitionPath.slice(0, -1);
    } else if (visibility?.kind === 'restricted') {
        const path = visibility.path;
        if (!Array.isArray(path) || !path.length) return false;
        if (path[0] === 'crate') {
            visibleFrom = [];
            for (let offset = 1; offset < path.length; offset++) {
                if (path[offset] === 'crate' || path[offset] === 'self' || path[offset] === 'super') return false;
                visibleFrom.push(path[offset]);
            }
        } else if (path[0] === 'self') {
            visibleFrom = [...definitionPath];
            for (let offset = 1; offset < path.length; offset++) {
                if (path[offset] === 'crate' || path[offset] === 'self' || path[offset] === 'super') return false;
                visibleFrom.push(path[offset]);
            }
        } else if (path[0] === 'super') {
            visibleFrom = [...definitionPath];
            let offset = 0;
            while (path[offset] === 'super') {
                if (!visibleFrom.length) return false;
                visibleFrom.pop();
                offset += 1;
            }
            for (; offset < path.length; offset++) {
                if (path[offset] === 'crate' || path[offset] === 'self') return false;
                visibleFrom.push(path[offset]);
            }
        } else {
            return false;
        }
        if (!pathStartsWith(definitionPath, visibleFrom)) return false;
    } else if (visibility?.kind === 'unknown') {
        return false;
    } else {
        visibleFrom = definitionPath;
    }
    return pathStartsWith(callerPath, visibleFrom);
}

function rustEntryVisible(entry, targetContext, callerContext, callerModulePath) {
    const definitionPath = rustPathForContext(targetContext, entry.modulePath || [], callerContext);
    const callerPath = rustPathForContext(callerContext, callerModulePath, callerContext);
    return rustVisibilityAllows(entry.visibility || 'private', definitionPath, callerPath);
}

function rustModuleVisible(module, ownerContext, callerContext, callerModulePath) {
    const definitionPath = rustPathForContext(ownerContext, module.modulePath || [], callerContext);
    const callerPath = rustPathForContext(callerContext, callerModulePath, callerContext);
    return rustVisibilityAllows(module.visibility || 'private', definitionPath, callerPath);
}

function isVisibleInScope(entry, scopePath) {
    const entryPath = entry.scopePath || [];
    if (entryPath.length > scopePath.length) return false;
    return entryPath.every((part, index) => part === scopePath[index]);
}

function visibleRustModule(context, name, scopePath, modulePath = []) {
    const entries = context.rustModules.get(name) || [];
    const visible = entries.filter(entry => isVisibleInScope(entry, scopePath)
        && JSON.stringify(entry.modulePath || []) === JSON.stringify(modulePath || []));
    if (!visible.length) return null;
    const deepest = Math.max(...visible.map(entry => (entry.scopePath || []).length));
    const candidates = visible.filter(entry => (entry.scopePath || []).length === deepest);
    return candidates.length === 1 ? candidates[0] : null;
}

function visibleRustBinding(context, name, scopePath, modulePath = []) {
    const entries = context.importBindings.get(name) || [];
    const visible = entries.filter(entry => isVisibleInScope(entry, scopePath)
        && JSON.stringify(entry.modulePath || []) === JSON.stringify(modulePath || []));
    if (!visible.length) return null;
    const deepest = Math.max(...visible.map(entry => (entry.scopePath || []).length));
    const candidates = visible.filter(entry => (entry.scopePath || []).length === deepest);
    return candidates.length === 1 ? candidates[0] : { ambiguous: true, scopePath: candidates[0].scopePath };
}

function nearestVisible(entries, scopePath) {
    const visible = entries.filter(entry => isVisibleInScope(entry, scopePath));
    if (!visible.length) return [];
    const deepest = Math.max(...visible.map(entry => (entry.scopePath || []).length));
    return visible.filter(entry => (entry.scopePath || []).length === deepest);
}

function addDeclaration(context, ast, description, wrapper, ancestors = []) {
    const key = nodeKey(ast);
    if (!description?.nameNode || context.declarationByKey.has(key)) return context.declarationByKey.get(key) || null;
    const range = nodeSpan(context, ast);
    if (!addRecord(context)) return null;
    const name = description.name || textOf(description.nameNode);
    const id = `${name}@${range.start}`;
    const entry = { id, file: context.file, name, baseName: description.baseName || name, kind: description.kind,
        start: range.start, end: range.end, callable: description.callable === true, method: description.method === true,
        signatureOnly: description.signatureOnly === true, scopePath: scopePathForAncestors(context.language, ancestors), ast, nameNode: description.nameNode,
        ...(context.language === 'rust' ? { modulePath: rustModulePathForAncestors(ancestors), visibility: rustVisibility(ast) } : {}) };
    context.declarations.push(entry);
    context.declarationByKey.set(key, entry);
    if (wrapper) context.wrapperOwnerByKey.set(nodeKey(wrapper), entry);
    context.nameNodeKeys.add(nodeKey(description.nameNode));
    context.nodes.push({ id, name, kind: description.kind, start: range.start, end: range.end });
    return entry;
}

function collectDeclarations(context) {
    const language = context.language;
    walk(context, context.rootNode, (node, ancestors) => {
        if (language === 'mojo' && node.type === 'decorated_definition') {
            const definition = field(node, 'definition');
            if (definition) {
                const description = declarationDescription(language, definition, ancestors.concat(node), context);
                const entry = addDeclaration(context, definition, description, node, ancestors);
                if (entry) context.wrapperOwnerByKey.set(nodeKey(node), entry);
            }
        }
        if (context.declarationByKey.has(nodeKey(node))) return true;
        const description = declarationDescription(language, node, ancestors, context);
        addDeclaration(context, node, description, null, ancestors);
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
    context.nodes.sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

function ownerFor(context, ancestors) {
    for (let index = ancestors.length - 1; index >= 0; index--) {
        const key = nodeKey(ancestors[index]);
        const entry = context.declarationByKey.get(key) || context.wrapperOwnerByKey.get(key);
        if (entry) return entry;
    }
    return context.init;
}

function addSite(context, site) {
    if (!addRecord(context)) return false;
    context.sites.push(site);
    return true;
}

function targetFor(entry) {
    return { file: entry.file, node: entry.id };
}

function candidateFor(entry) {
    return { file: entry.file, node: entry.id };
}

function dedupeEntries(entries) {
    return [...new Map(entries.map(entry => [entry.file + '\u0000' + entry.id, entry])).values()];
}

function parseGoMetadata(files) {
    return Object.keys(files).filter(file => path.posix.basename(normalizeFile(file)) === 'go.mod').flatMap(file => {
        const match = /(?:^|\n)\s*module\s+([^\s#]+)\s*(?:#.*)?(?:$|\n)/u.exec(files[file]);
        return match ? [{ file, root: dirname(file), module: match[1] }] : [];
    });
}

function parseCargoMetadata(files) {
    return Object.keys(files).filter(file => path.posix.basename(normalizeFile(file)) === 'Cargo.toml').map(file => ({
        file, root: dirname(file), content: files[file]
    }));
}

function goPackageName(source) {
    return /^\s*package\s+([\p{L}_][\p{L}\p{N}_]*)/mu.exec(source)?.[1] || null;
}

function packageSources(index, directory, packageName) {
    return [...index.values()].filter(context => context.language === 'go' && dirname(context.file) === directory
        && (!packageName || context.goPackage === packageName));
}

function resolveGoImport(context, specifier, metadata, index) {
    const matches = metadata.filter(item => specifier === item.module || specifier.startsWith(item.module + '/'))
        .sort((left, right) => right.module.length - left.module.length);
    if (!matches.length) return { kind: 'external' };
    const module = matches[0];
    const suffix = specifier === module.module ? '' : specifier.slice(module.module.length + 1);
    const directory = joinPath(module.root, suffix);
    const sources = packageSources(index, directory, null);
    if (!sources.length) return { kind: 'unresolved', reason: 'go-local-package-not-found' };
    const packageName = sources.find(item => item.goPackage)?.goPackage;
    const packageFiles = packageSources(index, directory, packageName);
    return { kind: 'local', directory, packageName, files: packageFiles };
}

function importAlias(specifier, nameNode) {
    const explicit = textOf(nameNode);
    if (explicit) return explicit;
    const parts = specifier.split('/');
    return parts[parts.length - 1] || specifier;
}

function goImportDescription(node) {
    const pathNode = field(node, 'path');
    if (!pathNode) return null;
    const specifier = decodeQuoted(textOf(pathNode));
    const nameNode = field(node, 'name');
    const alias = importAlias(specifier, nameNode);
    return { specifier, alias, nameNode, pathNode };
}

function collectGoImports(context, index, metadata) {
    walk(context, context.rootNode, (node) => {
        if (node.type !== 'import_spec') return true;
        const description = goImportDescription(node);
        if (!description) return true;
        const range = nodeSpan(context, node);
        const resolved = resolveGoImport(context, description.specifier, metadata, index);
        const alias = !description.nameNode && resolved.kind === 'local' && resolved.packageName
            ? resolved.packageName : description.alias;
        const target = resolved.kind === 'local' ? { file: [...resolved.files].sort((a, b) => a.file.localeCompare(b.file))[0]?.file } : undefined;
        const site = { owner: context.init.id, relation: 'import', name: description.specifier, start: range.start, end: range.end,
            phase: 'module-init', resolution: resolved.kind === 'local' ? 'resolved' : resolved.kind, specifier: description.specifier, loading: 'eager',
            ...(target?.file ? { target } : {}), ...(resolved.reason ? { reason: resolved.reason } : {}) };
        addSite(context, site);
        context.goImports.set(alias, { ...description, alias, resolved });
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
}

function rustUseName(node) {
    const argument = field(node, 'argument') || namedChildren(node).find(child => child.type !== 'visibility_modifier');
    return textOf(argument).replace(/;\s*$/u, '').trim();
}

function rustUseBinding(node) {
    const aliases = [];
    walkShallow(node, current => {
        if (current.type === 'use_as_clause') {
            const alias = field(current, 'alias');
            const pathNode = field(current, 'path');
            if (alias && pathNode) aliases.push({ name: textOf(alias), path: textOf(pathNode) });
            return false;
        }
        return true;
    });
    const argument = field(node, 'argument');
    const plain = textOf(argument).replace(/[{}*]/gu, '').split('::').filter(Boolean).pop()?.trim();
    if (plain && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(plain) && !aliases.some(item => item.name === plain)) aliases.push({ name: plain, path: textOf(argument) });
    return aliases;
}

function walkShallow(root, visit) {
    if (!root) return;
    const stack = [root];
    while (stack.length) {
        const node = stack.pop();
        if (visit(node) === false) continue;
        for (const child of namedChildren(node).reverse()) stack.push(child);
    }
}

function rustModuleParent(context) {
    const file = normalizeFile(context.file);
    const base = path.posix.basename(file);
    if (base === 'mod.rs' || base === 'lib.rs' || base === 'main.rs') return dirname(file);
    const stem = base.endsWith('.rs') ? base.slice(0, -'.rs'.length) : base;
    return joinPath(dirname(file), stem);
}

function rustModuleCandidate(context, moduleName, modulePath, index) {
    const parent = joinPath(rustModuleParent(context), ...(modulePath || []));
    const candidates = [joinPath(parent, moduleName + '.rs'), joinPath(parent, moduleName, 'mod.rs')]
        .filter(candidate => [...index.values()].some(item => item.language === 'rust' && normalizeFile(item.file) === candidate));
    if (candidates.length !== 1) return null;
    return [...index.values()].find(item => item.language === 'rust' && normalizeFile(item.file) === candidates[0]) || null;
}

function rustRootCandidates(context, index, cargo) {
    if (!cargo) return [];
    const roots = [...index.values()].filter(item => item.language === 'rust' && isUnder(item.file, cargo.root)
        && /(?:^|\/)src\/(?:lib|main)\.rs$/u.test(normalizeFile(item.file)));
    return roots;
}

function cargoForContext(context, cargoMetadata) {
    return cargoMetadata.find(cargo => isUnder(context.file, cargo.root)) || null;
}

function resolveRustPath(context, pathText, index, cargo, scopePath = [], modulePath = []) {
    const parts = pathText.replace(/\s+/gu, '').split('::').filter(Boolean);
    if (!parts.length) return { kind: 'unresolved', reason: 'rust-empty-use-path' };
    let current = context;
    let offset = 0;
    let lookupScopePath = scopePath;
    let lookupModulePath = [...modulePath];
    let targetScopePath = [...modulePath];
    const moveSuper = () => {
        if (lookupModulePath.length) {
            lookupModulePath = lookupModulePath.slice(0, -1);
            lookupScopePath = [...lookupModulePath];
            targetScopePath = [...lookupModulePath];
            return null;
        }
        const origins = rustModuleOrigins(index, current);
        if (origins.length !== 1) return { kind: 'unresolved', reason: 'rust-super-module-unresolved' };
        const origin = origins[0];
        current = origin.context;
        lookupScopePath = [...origin.module.scopePath];
        lookupModulePath = [...origin.module.modulePath];
        targetScopePath = [...lookupModulePath];
        return null;
    };
    const descend = (entry) => {
        if (entry.inline) {
            targetScopePath = [...(entry.modulePath || []), entry.name];
            lookupScopePath = targetScopePath;
            lookupModulePath = targetScopePath;
            return null;
        }
        if (!entry.target) return { kind: 'unresolved', reason: 'rust-module-file-not-found' };
        current = entry.target;
        lookupScopePath = [];
        lookupModulePath = [];
        targetScopePath = [];
        return null;
    };
    if (parts[0] === 'crate') {
        const roots = rustRootCandidates(context, index, cargo);
        if (roots.length !== 1) return { kind: 'unresolved', reason: 'rust-crate-root-ambiguous' };
        current = roots[0]; offset = 1; lookupScopePath = []; lookupModulePath = []; targetScopePath = [];
    } else if (parts[0] === 'self') {
        offset = 1;
    } else if (parts[0] === 'super') {
        const failure = moveSuper();
        if (failure) return failure;
        offset = 1;
    }
    if (offset >= parts.length) return { kind: 'unresolved', reason: 'rust-empty-use-path' };
    for (; offset < parts.length - 1; offset++) {
        const part = parts[offset];
        if (part === 'super') {
            const failure = moveSuper();
            if (failure) return failure;
            continue;
        }
        if (part === 'crate' || part === 'self') return { kind: 'unresolved', reason: 'rust-module-path-unresolved' };
        const module = visibleRustModule(current, part, lookupScopePath, lookupModulePath);
        if (!module) {
            const declared = (current.rustModules.get(part) || []).some(entry => samePath(entry.modulePath || [], lookupModulePath));
            return offset === 0 && !declared ? { kind: 'external' } : { kind: 'unresolved', reason: 'rust-module-path-unresolved' };
        }
        if (!rustModuleVisible(module, current, context, modulePath)) {
            return { kind: 'unresolved', reason: 'rust-module-not-visible' };
        }
        const failure = descend(module);
        if (failure) return failure;
    }

    const terminal = parts[parts.length - 1];
    if (terminal === 'crate' || terminal === 'self' || terminal === 'super') {
        return { kind: 'unresolved', reason: 'rust-path-target-not-found' };
    }
    const declarations = current.declarations.filter(entry => entry.baseName === terminal && !entry.method && !entry.signatureOnly
        && samePath(entry.scopePath || [], targetScopePath));
    const visibleDeclarations = declarations.filter(entry => rustEntryVisible(entry, current, context, modulePath));
    if (visibleDeclarations.length > 1) return { kind: 'unresolved', reason: 'rust-path-target-ambiguous' };
    if (visibleDeclarations.length === 1) {
        const entry = visibleDeclarations[0];
        return { kind: 'local', file: current.file, name: terminal, scopePath: entry.scopePath, entry };
    }

    const module = visibleRustModule(current, terminal, lookupScopePath, lookupModulePath);
    if (module) {
        if (!rustModuleVisible(module, current, context, modulePath)) {
            return { kind: 'unresolved', reason: 'rust-module-not-visible' };
        }
        if (module.inline) {
            return { kind: 'local', file: current.file, name: terminal,
                scopePath: [...(module.modulePath || []), module.name], targetKind: 'module', module };
        }
        if (!module.target) return { kind: 'unresolved', reason: 'rust-module-file-not-found' };
        return { kind: 'local', file: module.target.file, name: terminal, scopePath: [], targetKind: 'module', module };
    }

    const declared = declarations.length || (current.rustModules.get(terminal) || []).some(entry => samePath(entry.modulePath || [], lookupModulePath));
    if (declared) return { kind: 'unresolved', reason: 'rust-path-target-not-visible' };
    if (offset === 0 && parts.length === 1) return { kind: 'external' };
    return { kind: 'unresolved', reason: 'rust-path-target-not-found' };
}

function collectRustModules(context, index) {
    walk(context, context.rootNode, (node, ancestors) => {
        if (node.type !== 'mod_item') return true;
        const name = field(node, 'name');
        if (!name) return true;
        const module = {
            name: textOf(name), node, inline: Boolean(field(node, 'body')),
            scopePath: scopePathForAncestors('rust', ancestors),
            modulePath: rustModulePathForAncestors(ancestors),
            visibility: rustVisibility(node)
        };
        module.target = module.inline ? null : rustModuleCandidate(context, module.name, module.modulePath, index);
        const entries = context.rustModules.get(module.name) || [];
        entries.push(module);
        context.rustModules.set(module.name, entries);
        if (!module.inline) {
            const range = nodeSpan(context, node);
            addSite(context, { owner: context.init.id, relation: 'import', name: module.name, start: range.start, end: range.end,
                phase: 'unknown', resolution: module.target ? 'resolved' : 'unresolved', specifier: module.name, loading: 'eager',
                ...(module.target ? { target: { file: module.target.file } } : { reason: 'rust-module-file-not-found' }) });
        }
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
}

function rustRootContexts(index, cargoMetadata) {
    const roots = new Set();
    for (const cargo of cargoMetadata) {
        for (const context of rustRootCandidates(null, index, cargo)) roots.add(context);
    }
    if (roots.size) return [...roots];
    return [...index.values()].filter(context => context.language === 'rust'
        && /(?:^|\/)(?:lib|main)\.rs$/u.test(normalizeFile(context.file)));
}

function addRustModulePath(context, modulePath) {
    // Two distinct paths already make ownership ambiguous. Capping here also
    // terminates invalid recursive module declarations without expanding paths forever.
    if (context.rustModulePaths.length < 2 && !context.rustModulePaths.some(existing => samePath(existing, modulePath))) {
        context.rustModulePaths.push(modulePath);
    }
}

function assignRustModulePaths(index, cargoMetadata) {
    const contexts = [...index.values()].filter(context => context.language === 'rust');
    for (const context of contexts) {
        context.rustModulePaths = [];
        context.rustModulePath = null;
    }
    for (const root of rustRootContexts(index, cargoMetadata)) addRustModulePath(root, []);

    let changed = true;
    while (changed) {
        changed = false;
        for (const context of contexts) {
            for (const module of context.rustModules.values()) {
                for (const entry of module) {
                    if (entry.inline || !entry.target) continue;
                    for (const parentPath of context.rustModulePaths) {
                        const targetPath = [...parentPath, ...(entry.modulePath || []), entry.name];
                        const before = entry.target.rustModulePaths.length;
                        addRustModulePath(entry.target, targetPath);
                        if (entry.target.rustModulePaths.length !== before) changed = true;
                    }
                }
            }
        }
    }
    for (const context of contexts) {
        if (context.rustModulePaths.length === 1) context.rustModulePath = context.rustModulePaths[0];
    }
}

function rustModuleOrigins(index, target) {
    const origins = [];
    for (const context of index.values()) {
        for (const entries of context.rustModules.values()) {
            for (const module of entries) {
                if (!module.inline && module.target === target) origins.push({ context, module });
            }
        }
    }
    return origins;
}

function collectRustImports(context, index, cargo) {
    walk(context, context.rootNode, (node, ancestors) => {
        if (node.type !== 'use_declaration') return true;
        const specifier = rustUseName(node);
        const scopePath = scopePathForAncestors('rust', ancestors);
        const modulePath = rustModulePathForAncestors(ancestors);
        const resolution = resolveRustPath(context, specifier, index, cargo, scopePath, modulePath);
        const isReexport = namedChildren(node).some(child => child.type === 'visibility_modifier' && textOf(child) === 'pub');
        const range = nodeSpan(context, node);
        addSite(context, { owner: context.init.id, relation: isReexport ? 'reexport' : 'import', name: specifier, start: range.start, end: range.end,
            phase: 'unknown', resolution: resolution.kind === 'local' ? 'resolved' : resolution.kind, specifier, loading: 'eager',
            ...(resolution.file ? { target: { file: resolution.file } } : {}), ...(resolution.reason ? { reason: resolution.reason } : {}) });
        for (const binding of rustUseBinding(node)) {
            const bindings = context.importBindings.get(binding.name) || [];
            bindings.push({ path: binding.path, resolution, scopePath, modulePath });
            context.importBindings.set(binding.name, bindings);
        }
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
}

function mojoImportNames(node) {
    return fields(node, 'name');
}

function collectMojoImports(context) {
    addDiagnostic(context, 'mojo-experimental', 'Mojo dependency extraction is experimental; lexical imports and compiler phases are not fully proven.');
    walk(context, context.rootNode, (node) => {
        if (node.type !== 'import_statement' && node.type !== 'import_from_statement') return true;
        const moduleNode = field(node, 'module_name');
        const moduleName = textOf(moduleNode || fields(node, 'name')[0] || node).trim();
        const names = node.type === 'import_from_statement' ? mojoImportNames(node) : fields(node, 'name');
        const entries = names.length ? names : [moduleNode || node];
        for (const nameNode of entries) {
            const name = textOf(nameNode).trim() || moduleName;
            const range = nodeSpan(context, nameNode);
            if (!addSite(context, { owner: context.init.id, relation: 'import', name, start: range.start, end: range.end,
                phase: 'unknown', resolution: 'external', specifier: moduleName, loading: 'eager', reason: 'mojo-import-resolution-unproven' })) return false;
            const alias = field(nameNode, 'comptime') || nameNode;
            const binding = textOf(alias).split('.').pop();
            if (binding) context.importBindings.set(binding, { path: moduleName + '.' + name, resolution: { kind: 'external' } });
        }
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
}

function isDeclarationName(context, node) {
    return context.nameNodeKeys.has(nodeKey(node));
}

function addPatternNames(node, output) {
    if (!node) return;
    walkShallow(node, current => {
        if (current.type === 'identifier' || current.type === 'field_identifier') output.add(textOf(current));
        return true;
    });
}

function bindingNames(context, entry) {
    if (!entry || entry === context.init) return EMPTY_SET;
    if (context.bindingCache.has(entry.id)) return context.bindingCache.get(entry.id).names;
    const names = new Set();
    const nodes = new Set();
    const root = entry.ast;
    walk(context, root, (node) => {
        if (node !== root && context.declarationByKey.has(nodeKey(node))) {
            const nested = context.declarationByKey.get(nodeKey(node));
            if (nested !== entry) {
                return false;
            }
        }
        const record = (candidate) => {
            if (!candidate) return;
            addPatternNames(candidate, names);
            walkShallow(candidate, current => {
                if (current.type === 'identifier' || current.type === 'field_identifier') nodes.add(nodeKey(current));
                return true;
            });
        };
        if (context.language === 'go') {
            if (node.type === 'parameter_declaration') for (const name of fields(node, 'name')) record(name);
            if (node.type === 'var_spec' || node.type === 'const_spec') for (const name of fields(node, 'name')) record(name);
            if (node.type === 'short_var_declaration') record(field(node, 'left') || namedChildren(node)[0]);
            if (node.type === 'range_clause') record(field(node, 'left') || namedChildren(node)[0]);
        } else if (context.language === 'rust') {
            if (node.type === 'parameter') record(field(node, 'pattern'));
            if (node.type === 'self_parameter') names.add('self');
            if (node.type === 'let_declaration') record(field(node, 'pattern'));
            if (node.type === 'for_expression') record(field(node, 'pattern') || namedChildren(node)[0]);
            if (node.type === 'closure_expression') record(field(node, 'parameters'));
            if (node.type === 'use_declaration') for (const binding of rustUseBinding(node)) names.add(binding.name);
        } else if (context.language === 'mojo') {
            if (node.type.endsWith('_parameter')) record(field(node, 'name'));
            if (node.type === 'self_parameter') names.add('self');
            if (node.type === 'parameters') {
                for (const parameter of namedChildren(node)) {
                    if (parameter.type === 'self_parameter') {
                        names.add('self');
                        continue;
                    }
                    const name = field(parameter, 'name');
                    if (name) record(name);
                    else if (parameter.type === 'identifier') record(parameter);
                }
            }
            if (node.type === 'assignment') record(field(node, 'left'));
            if (node.type === 'for_statement') record(field(node, 'left'));
        }
        return true;
    });
    const result = { names, nodes };
    context.bindingCache.set(entry.id, result);
    return names;
}

function bindingNodes(context, entry) {
    if (!entry || entry === context.init) return EMPTY_SET;
    if (!context.bindingCache.has(entry.id)) bindingNames(context, entry);
    return context.bindingCache.get(entry.id)?.nodes || EMPTY_SET;
}

function isCompileTimeRust(ancestors) {
    return hasAncestorType(ancestors, new Set(['const_item', 'static_item', 'const_block', 'associated_type', 'associated_const']));
}

function sitePhase(context, owner, node, ancestors) {
    if (context.language === 'go') {
        if (hasAncestorType(ancestors, new Set(['func_literal']))) return 'invocation';
        return owner?.kind === 'function' && (owner.baseName !== 'init' || owner.method) ? 'invocation' : 'module-init';
    }
    if (context.language === 'rust') {
        if (isCompileTimeRust(ancestors)) return 'unknown';
        return owner?.kind === 'function' ? 'invocation' : 'module-init';
    }
    if (context.language === 'mojo') {
        if (owner?.kind === 'function' && nodeContains(field(owner.ast, 'body'), node)) return 'invocation';
        return 'unknown';
    }
    return 'unknown';
}

function isTypeReference(node, ancestors) {
    if (node.type === 'type_identifier') return true;
    return hasAncestorType(ancestors, new Set([
        'type', 'type_identifier', 'type_annotation', 'return_type', 'parameter_declaration', 'parameter',
        'typed_default_parameter', 'reference_type', 'pointer_type', 'generic_type', 'type_arguments',
        'field_declaration', 'primitive_type', 'scoped_type_identifier', 'generic_type'
    ]));
}

function isInsideImportOrDeclarationPath(ancestors) {
    return hasAncestorType(ancestors, new Set([
        'import_spec', 'import_declaration', 'use_declaration', 'scoped_use_list', 'use_list', 'use_as_clause',
        'import_statement', 'import_from_statement', 'aliased_import', 'package_clause', 'mod_item',
        'attribute_item', 'decorator', 'visibility_modifier'
    ]));
}

function isMemberPath(node, ancestors) {
    if (node.type === 'field_identifier') return true;
    return hasAncestorType(ancestors, new Set(['selector_expression', 'field_expression', 'attribute', 'member_expression']));
}

function directCallee(context, node) {
    const candidate = field(node, 'function') || field(node, 'macro') || field(node, 'callee');
    if (!candidate) return { kind: 'unknown', name: textOf(node) };
    if (candidate.type === 'identifier' || candidate.type === 'type_identifier') return { kind: 'direct', name: textOf(candidate), node: candidate };
    if (candidate.type === 'field_identifier') return { kind: 'member', name: textOf(candidate), node: candidate };
    if (candidate.type === 'selector_expression' || candidate.type === 'field_expression' || candidate.type === 'attribute' || candidate.type === 'member_expression') {
        const value = textOf(candidate);
        return { kind: 'member', name: value, node: candidate };
    }
    if (candidate.type === 'scoped_identifier' || candidate.type === 'scoped_type_identifier' || candidate.type === 'generic_function') {
        return { kind: 'scoped', name: textOf(candidate), node: candidate };
    }
    return { kind: 'unsupported', name: textOf(candidate), node: candidate };
}

function entriesForName(index, file, name, language, scopePath = []) {
    const entries = [...index.values()].flatMap(context => context.language === language
        ? context.declarations.filter(entry => entry.baseName === name && !entry.method && entry.kind !== 'module-init')
        : []).filter(entry => entry.file === file);
    return nearestVisible(entries, scopePath);
}

function declaredEntriesForName(index, file, name, language) {
    return [...index.values()].flatMap(context => context.language === language
        ? context.declarations.filter(entry => entry.baseName === name && !entry.method && entry.kind !== 'module-init')
        : []).filter(entry => entry.file === file);
}

function packageEntries(index, files, name) {
    const allowed = new Set(files.map(context => context.file));
    return [...index.values()].flatMap(context => allowed.has(context.file)
        ? context.declarations.filter(entry => entry.baseName === name && !entry.method && entry.kind !== 'module-init') : []);
}

function chooseCandidates(candidates) {
    const unique = dedupeEntries(candidates);
    if (unique.length === 1) return { resolution: 'resolved', entry: unique[0] };
    if (unique.length > 1) return { resolution: 'ambiguous', candidates: unique };
    return { resolution: 'unresolved' };
}

function resolveRustCallTarget(resolved) {
    if (resolved.kind !== 'local') return { resolution: 'unresolved', reason: resolved.reason || 'rust-path-unresolved' };
    if (resolved.targetKind === 'module' || !resolved.entry) {
        return { resolution: 'unresolved', reason: 'rust-path-target-not-callable' };
    }
    return chooseCandidates([resolved.entry]);
}

function resolveGoCall(context, callee, owner, index, goMetadata, scopePath) {
    const name = callee.name;
    const bindings = bindingNames(context, owner);
    if (callee.kind === 'direct') {
        if (bindings.has(name)) return { resolution: 'unresolved', reason: 'go-shadowed-local-binding' };
        const sameFile = entriesForName(index, context.file, name, 'go', scopePath);
        if (sameFile.length) return chooseCandidates(sameFile);
        const packageName = context.goPackage;
        if (!packageName) return { resolution: 'unresolved', reason: 'go-package-unknown' };
        const candidates = [];
        for (const item of index.values()) {
            if (item.language !== 'go' || item.goPackage !== packageName || item.goDirectory !== context.goDirectory || item.file === context.file) continue;
            const module = goMetadata.find(metadata => isUnder(context.file, metadata.root) && isUnder(item.file, metadata.root));
            if (module) candidates.push(...item.declarations.filter(entry => entry.baseName === name && !entry.method && entry.kind !== 'module-init'));
        }
        return candidates.length ? chooseCandidates(candidates) : { resolution: 'unresolved', reason: 'go-function-not-found' };
    }
    if (callee.kind === 'member') {
        const dot = /^([\p{L}_][\p{L}\p{N}_]*)\.([\p{L}_][\p{L}\p{N}_]*)$/u.exec(name);
        if (dot) {
            const imported = context.goImports.get(dot[1]);
            if (imported?.alias === '.') return { resolution: 'unresolved', reason: 'go-dot-import-dispatch' };
            if (imported) {
                if (bindingNames(context, owner).has(dot[1])) return { resolution: 'unresolved', reason: 'go-shadowed-package-binding' };
                if (imported.resolved.kind === 'external') return { resolution: 'external', reason: 'go-external-package' };
                if (imported.resolved.kind === 'local') return chooseCandidates(packageEntries(index, imported.resolved.files, dot[2]));
                return { resolution: 'unresolved', reason: imported.resolved.reason || 'go-import-unresolved' };
            }
        }
        return { resolution: 'unsupported', reason: 'go-method-or-selector-dispatch' };
    }
    return { resolution: 'unsupported', reason: 'go-call-dispatch-unproven' };
}

function resolveRustCall(context, callee, owner, index, cargo, scopePath, modulePath = []) {
    if (callee.kind === 'scoped') {
        const first = callee.name.split('::')[0];
        const knownModule = first === 'crate' || first === 'self' || first === 'super'
            || Boolean(visibleRustModule(context, first, scopePath, modulePath));
        if (!knownModule) return { resolution: 'unsupported', reason: 'rust-path-or-method-dispatch' };
        const resolved = resolveRustPath(context, callee.name, index, cargo, scopePath, modulePath);
        if (resolved.kind === 'local') return resolveRustCallTarget(resolved);
        if (resolved.kind === 'external') return { resolution: 'external', reason: 'rust-external-path' };
        return { resolution: 'unresolved', reason: resolved.reason || 'rust-path-unresolved' };
    }
    if (callee.kind !== 'direct') return { resolution: 'unsupported', reason: 'rust-path-or-method-dispatch' };
    const name = callee.name;
    if (bindingNames(context, owner).has(name)) return { resolution: 'unresolved', reason: 'rust-shadowed-local-binding' };
    const sameFile = entriesForName(index, context.file, name, 'rust', scopePath).filter(entry => !entry.signatureOnly);
    const imported = visibleRustBinding(context, name, scopePath, modulePath);
    const localDepth = sameFile.length ? (sameFile[0].scopePath || []).length : -1;
    const importDepth = imported ? (imported.scopePath || []).length : -1;
    if (sameFile.length && imported && localDepth === importDepth) {
        return { resolution: 'unresolved', reason: 'rust-local-import-collision' };
    }
    if (sameFile.length && (!imported || localDepth > importDepth)) return chooseCandidates(sameFile);
    if (imported?.ambiguous) return { resolution: 'unresolved', reason: 'rust-import-ambiguous' };
    if (imported) {
        const resolved = imported.resolution?.kind === 'local'
            ? imported.resolution
            : resolveRustPath(context, imported.path, index, cargo, imported.scopePath, imported.modulePath);
        if (resolved.kind === 'local') return resolveRustCallTarget(resolved);
        if (resolved.kind === 'external') return { resolution: 'external', reason: 'rust-external-path' };
        return { resolution: 'unresolved', reason: resolved.reason || 'rust-import-unresolved' };
    }
    if (sameFile.length) return chooseCandidates(sameFile.filter(entry => !entry.signatureOnly));
    if (declaredEntriesForName(index, context.file, name, 'rust').length) {
        return { resolution: 'unresolved', reason: 'rust-name-not-visible-in-module' };
    }
    return { resolution: 'unresolved', reason: 'rust-function-not-found' };
}

function resolveMojoCall(context, callee, owner, index, scopePath) {
    if (callee.kind !== 'direct') return { resolution: 'unsupported', reason: 'mojo-member-dispatch' };
    const name = callee.name;
    if (bindingNames(context, owner).has(name)) return { resolution: 'unresolved', reason: 'mojo-shadowed-local-binding' };
    const candidates = entriesForName(index, context.file, name, 'mojo', scopePath);
    if (candidates.length) return chooseCandidates(candidates);
    if (declaredEntriesForName(index, context.file, name, 'mojo').length) {
        return { resolution: 'unresolved', reason: 'mojo-name-not-visible-in-scope' };
    }
    if (context.importBindings.has(name)) return { resolution: 'external', reason: 'mojo-import-resolution-unproven' };
    return { resolution: 'unresolved', reason: 'mojo-function-not-found' };
}

function resolveCall(context, callee, owner, index, metadata, scopePath, modulePath = []) {
    if (context.language === 'go') return resolveGoCall(context, callee, owner, index, metadata.go, scopePath);
    if (context.language === 'rust') return resolveRustCall(context, callee, owner, index, cargoForContext(context, metadata.cargo), scopePath, modulePath);
    return resolveMojoCall(context, callee, owner, index, scopePath);
}

function makeCallSite(context, node, ancestors, owner, callee, index, metadata, relationOverride) {
    const range = nodeSpan(context, node);
    const scopePath = scopePathForAncestors(context.language, ancestors);
    const modulePath = context.language === 'rust' ? rustModulePathForAncestors(ancestors) : [];
    const result = resolveCall(context, callee, owner, index, metadata, scopePath, modulePath);
    const entry = result.entry;
    const relation = relationOverride || (entry?.kind === 'class' ? 'construct' : 'call');
    const site = { owner: owner.id, relation, name: callee.name, start: range.start, end: range.end,
        phase: sitePhase(context, owner, node, ancestors), resolution: result.resolution,
        ...(entry ? { target: targetFor(entry) } : {}),
        ...(result.candidates ? { candidates: result.candidates.map(candidateFor) } : {}),
        ...(result.reason ? { reason: result.reason } : {}) };
    addSite(context, site);
    if (result.resolution === 'unsupported') {
        const code = context.language + '-dispatch-unsupported';
        addDiagnostic(context, code, `Call '${callee.name}' was not resolved because dispatch or path semantics are not provable statically.`);
    }
}

function callNodeInfo(context, node) {
    const expected = context.language === 'go' ? 'call_expression' : context.language === 'rust' ? 'call_expression' : 'call';
    if (node.type !== expected) return null;
    return directCallee(context, node);
}

function isMacroNode(context, node) {
    return context.language === 'rust' && node.type === 'macro_invocation';
}

function macroSite(context, node, ancestors, owner) {
    const macro = field(node, 'macro') || namedChildren(node).find(child => child.type === 'identifier');
    const name = textOf(macro) || textOf(node).split('!')[0].trim();
    const range = nodeSpan(context, node);
    addSite(context, { owner: owner.id, relation: 'call', name, start: range.start, end: range.end,
        phase: sitePhase(context, owner, node, ancestors), resolution: 'unsupported', reason: 'rust-macro-unexpanded' });
    addDiagnostic(context, 'rust-macro-unexpanded', 'Rust macro invocations are not expanded; imports, declarations, and calls inside them are unknown.');
}

function compositeTypeCallee(context, node) {
    const type = field(node, 'type') || field(node, 'name');
    if (!type) return null;
    const value = textOf(type).trim();
    if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) return { kind: 'direct', name: value };
    if (context.language === 'go' && /^[\p{L}_][\p{L}\p{N}_]*\.[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) {
        return { kind: 'member', name: value };
    }
    if (context.language === 'rust' && /^[\p{L}_][\p{L}\p{N}_]*(?:::[\p{L}_][\p{L}\p{N}_]*)+$/u.test(value)) {
        return { kind: 'scoped', name: value };
    }
    return null;
}

function scanSites(context, index, metadata) {
    if (context.truncated) return;
    walk(context, context.rootNode, (node, ancestors) => {
        const owner = ownerFor(context, ancestors);
        if (isMacroNode(context, node)) {
            macroSite(context, node, ancestors, owner);
            return false;
        }
        const call = callNodeInfo(context, node);
        if (call) {
            makeCallSite(context, node, ancestors, owner, call, index, metadata);
            return true;
        }
        if (context.language === 'go' && node.type === 'composite_literal') {
            const callee = compositeTypeCallee(context, node);
            if (callee) makeCallSite(context, node, ancestors, owner, callee, index, metadata, 'construct');
            return true;
        }
        if (context.language === 'rust' && node.type === 'struct_expression') {
            const callee = compositeTypeCallee(context, node);
            if (callee) makeCallSite(context, node, ancestors, owner, callee, index, metadata, 'construct');
            return true;
        }
        if (node.type === 'identifier' || node.type === 'type_identifier') {
            if (isDeclarationName(context, node) || isInsideImportOrDeclarationPath(ancestors) || isMemberPath(node, ancestors)) return true;
            if (bindingNodes(context, owner).has(nodeKey(node))) return true;
            // The callee and constructor name are represented by the enclosing
            // call/construct site. Arguments remain eligible for references.
            const callParent = ancestors[ancestors.length - 1];
            if (callParent && ['call_expression', 'call', 'struct_expression', 'composite_literal'].includes(callParent.type)) {
                const calleeNode = field(callParent, 'function') || field(callParent, 'callee') || field(callParent, 'macro')
                    || field(callParent, 'type') || field(callParent, 'name');
                if (calleeNode && (nodeKey(calleeNode) === nodeKey(node) || nodeContains(calleeNode, node))) return true;
            }
            const name = textOf(node);
            const scopePath = scopePathForAncestors(context.language, ancestors);
            const modulePath = context.language === 'rust' ? rustModulePathForAncestors(ancestors) : [];
            const result = context.language === 'go'
                ? resolveGoCall(context, { kind: 'direct', name }, owner, index, metadata.go, scopePath)
                : context.language === 'rust'
                    ? resolveRustCall(context, { kind: 'direct', name }, owner, index, cargoForContext(context, metadata.cargo), scopePath, modulePath)
                    : resolveMojoCall(context, { kind: 'direct', name }, owner, index, scopePath);
            if (result.resolution === 'resolved' || result.resolution === 'ambiguous') {
                const range = nodeSpan(context, node);
                const type = isTypeReference(node, ancestors) ? 'type' : sitePhase(context, owner, node, ancestors);
                addSite(context, { owner: owner.id, relation: 'reference', name, start: range.start, end: range.end,
                    phase: type, resolution: result.resolution,
                    ...(result.entry ? { target: targetFor(result.entry) } : {}),
                    ...(result.candidates ? { candidates: result.candidates.map(candidateFor) } : {}) });
            }
        }
        return true;
    });
    if (context.truncated) addDiagnostic(context, 'truncated', `Dependency AST traversal/output was truncated at ${MAX_TRAVERSAL_NODES} traversed nodes or ${MAX_RECORDS} records.`);
}

function finalizeContext(context) {
    context.sites.sort((left, right) => left.start - right.start || left.end - right.end || left.relation.localeCompare(right.relation));
    context.nodes.sort((left, right) => (left.kind === 'module-init' ? -1 : right.kind === 'module-init' ? 1 : 0)
        || left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
    return { status: 'complete', nodes: context.nodes, sites: context.sites, diagnostics: context.diagnostics };
}

function invalidContext(file, source, language, code, message) {
    const context = createContext(file, source, language);
    addDiagnostic(context, code, message);
    return { status: 'invalid', nodes: context.nodes, sites: [], diagnostics: context.diagnostics };
}

async function parseContext(context) {
    try {
        const grammar = await loadLanguage(context.language);
        context.parser = new Parser();
        context.parser.setLanguage(grammar);
        context.tree = context.parser.parse(context.source);
        context.rootNode = context.tree?.rootNode;
        if (!context.rootNode || context.rootNode.hasError) {
            return invalidContext(context.file, context.source, context.language, 'syntax-invalid', 'tree-sitter-syntax-error');
        }
        collectDeclarations(context);
        return null;
    } catch (error) {
        return invalidContext(context.file, context.source, context.language, 'parser-failed', error instanceof Error ? error.message : String(error));
    }
}

function releaseContext(context) {
    try { context.tree?.delete(); } catch { /* best effort */ }
    try { context.parser?.delete(); } catch { /* best effort */ }
    context.tree = null; context.parser = null; context.rootNode = null;
}

function prepareIndex(contexts) {
    const index = new Map(contexts.map(context => [context.file, context]));
    for (const context of contexts) {
        if (context.language === 'go') {
            context.goPackage = goPackageName(context.source);
            context.goDirectory = dirname(context.file);
        }
    }
    return index;
}

async function analyzeParserDependencies(files) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('invalid-files');
    const keys = Object.keys(files);
    if (keys.length > MAX_FILES) throw new Error('file-budget');
    let bytes = 0;
    for (const file of keys) {
        if (typeof files[file] !== 'string') throw new Error('invalid-file-text');
        const size = Buffer.byteLength(files[file], 'utf8');
        if (size > MAX_FILE_BYTES) throw new Error('file-byte-budget');
        bytes += size;
    }
    if (bytes > MAX_INPUT_BYTES) throw new Error('input-byte-budget');

    const goMetadata = parseGoMetadata(files);
    const cargoMetadata = parseCargoMetadata(files);
    const contexts = [];
    const documents = {};
    for (const file of keys.sort()) {
        const language = languageFor(file);
        if (!SUPPORTED.has(language)) continue;
        const context = createContext(file, files[file], language);
        const invalid = await parseContext(context);
        if (invalid) {
            documents[file] = invalid;
            releaseContext(context);
        } else {
            contexts.push(context);
        }
    }

    const index = prepareIndex(contexts);
    const metadata = { go: goMetadata, cargo: cargoMetadata };
    for (const context of contexts) {
        if (context.language === 'go') collectGoImports(context, index, goMetadata);
        else if (context.language === 'rust') collectRustModules(context, index);
        else collectMojoImports(context);
    }
    assignRustModulePaths(index, cargoMetadata);
    for (const context of contexts) {
        if (context.language === 'rust') collectRustImports(context, index, cargoForContext(context, cargoMetadata));
    }
    for (const context of contexts) scanSites(context, index, metadata);
    for (const context of contexts) {
        documents[context.file] = finalizeContext(context);
        releaseContext(context);
    }
    return { producer: PRODUCER, documents };
}

module.exports = { analyzeParserDependencies };
