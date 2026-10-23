const ts = require('typescript');
const { createHash } = require('node:crypto');
const digest = text => createHash('sha256').update(text).digest('hex');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx|pyi?)$/;
const isSupportedSource = path => sourceExtensions.test(path);

function pythonInventory(files, options) {
    const result = spawnSync(options.python || process.env.MAPPING_PYTHON || 'python3',
        ['-I', '-S', path.join(__dirname, 'python-inventory.py')], {
            input: JSON.stringify(files), encoding: 'utf8', windowsHide: true,
            timeout: options.pythonTimeoutMs || 10000, maxBuffer: options.pythonMaxOutputBytes || 16777216
        });
    let reason;
    if (result.error) reason = result.error.code === 'ETIMEDOUT' ? 'python-parser-timeout' : 'python-parser-process: ' + result.error.code;
    else if (result.status !== 0) reason = 'python-parser-exit-' + result.status;
    else {
        try {
            const parsed = JSON.parse(result.stdout);
            if (!parsed.parser?.startsWith('cpython@') || !parsed.documents || Object.keys(files).some(p => !parsed.documents[p])) throw new Error();
            return parsed;
        } catch { reason = 'invalid-python-parser-output'; }
    }
    return { parser: 'cpython@unavailable', documents: Object.fromEntries(Object.keys(files).map(p => [p,
        { status: 'invalid', diagnostics: [{ message: reason }], entries: [], exclusions: [] }])) };
}

// Inventory is independent of the external matcher. Coordinates always index
// the exact caller-supplied string (UTF-16, zero-based, half-open).
function inventorySnapshot(files, side, options = {}) {
    const entries = [], documents = [], exclusions = [];
    const snapshotId = digest(JSON.stringify(Object.keys(files).sort().map(path => [path, digest(files[path])])));
    const pythonFiles = Object.fromEntries(Object.entries(files).filter(([p]) => /\.pyi?$/.test(p)));
    const python = Object.keys(pythonFiles).length ? pythonInventory(pythonFiles, options) : null;
    const parsers = new Set();
    if (python) parsers.add(python.parser);
    for (const path of Object.keys(files).sort()) {
        const text = files[path];
        const document = { path, digest: digest(text), utf16Length: text.length, status: 'complete', diagnostics: [] };
        documents.push(document);
        if (!sourceExtensions.test(path)) {
            document.status = 'unsupported';
            exclusions.push({ path, reason: 'unsupported-language' });
            continue;
        }
        if (/\.pyi?$/.test(path)) {
            const parsed = python.documents[path];
            document.status = parsed.status;
            document.diagnostics = parsed.diagnostics;
            exclusions.push(...parsed.exclusions.map(e => ({ path, ...e })));
            for (const declaration of parsed.entries) {
                const { start, end, kind, qualifiedName } = declaration;
                if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
                    throw new Error('invalid-python-declaration-range');
                }
                entries.push({ ...declaration, side, path, digest: digest(text.slice(start, end)),
                    engineRanges: [{ start, end }, ...declaration.engineRanges],
                    id: digest(JSON.stringify([snapshotId, side, path, kind, qualifiedName, start, end])) });
            }
            continue;
        }
        parsers.add('typescript@' + ts.version);
        const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        if (sf.parseDiagnostics.length) {
            document.status = 'invalid';
            document.diagnostics = sf.parseDiagnostics.map(d => ({ start: d.start, length: d.length,
                message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }));
            continue;
        }
        function add(node, name, kind, parent, callable = false, alternatives = []) {
            const start = node.getStart(sf), end = node.end;
            const qualifiedName = parent ? `${parent}.${name}` : name;
            const entry = { side, path, name, qualifiedName, kind, parent, callable, start, end,
                startLine: sf.getLineAndCharacterOfPosition(start).line,
                endLine: sf.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1,
                digest: digest(text.slice(start, end)),
                engineRanges: [{ start, end }, ...alternatives.map(n => ({ start: n.getStart(sf), end: n.end }))] };
            entry.id = digest(JSON.stringify([snapshotId, side, path, kind, qualifiedName, start, end]));
            entries.push(entry);
            return qualifiedName;
        }
        const nameOf = node => node.name?.text ?? node.name?.getText(sf) ?? 'default';
        const staticMemberName = node => {
            const name = node.name;
            if (!name || ts.isComputedPropertyName(name)) return null;
            if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
                return name.text ?? name.getText(sf);
            }
            return null;
        };
        const registrationOf = node => {
            if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return null;
            const call = node.expression;
            if (!ts.isIdentifier(call.expression) || call.questionDotToken || call.expression.text !== 'registerType' || call.arguments.length !== 2) return null;
            const [name, options] = call.arguments;
            if (!ts.isStringLiteral(name) || !name.text || !ts.isObjectLiteralExpression(options)) return null;
            return { name: name.text, options };
        };
        function visit(node, parent = null, declarationContext = false) {
            if (ts.isFunctionDeclaration(node)) {
                const name = add(node, nameOf(node), 'function', parent, true);
                if (node.body) visit(node.body, name, true);
            } else if (ts.isClassDeclaration(node)) {
                const name = add(node, nameOf(node), 'class', parent);
                for (const member of node.members) {
                    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
                        const kind = ts.isConstructorDeclaration(member) ? 'constructor' : ts.isGetAccessor(member) ? 'getter' : ts.isSetAccessor(member) ? 'setter' : 'method';
                        const memberName = ts.isConstructorDeclaration(member) ? 'constructor' : nameOf(member);
                        const qualified = add(member, memberName, kind, name, true);
                        if (member.body) visit(member.body, qualified, true);
                    } else if (ts.isPropertyDeclaration(member)) {
                        const init = member.initializer;
                        const callable = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
                        const qualified = add(member, nameOf(member), 'property', name, callable, callable ? [init] : []);
                        if (callable && ts.isBlock(init.body)) visit(init.body, qualified, true);
                    } else exclusions.push({ path, start: member.getStart(sf), reason: 'unsupported-class-member' });
                }
            } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
                add(node, nameOf(node), ts.isInterfaceDeclaration(node) ? 'interface' : ts.isEnumDeclaration(node) ? 'enum' : 'type', parent);
            } else if (ts.isVariableStatement(node)) {
                for (const decl of node.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name)) {
                        exclusions.push({ path, start: decl.getStart(sf), reason: 'destructured-binding' });
                        continue;
                    }
                    const init = decl.initializer;
                    const callable = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
                    if (parent && !callable) continue;
                    // The statement captures export/const/let context; each
                    // declarator still has an independent identity and name.
                    const name = add(decl, decl.name.text, callable ? 'function-variable' : 'variable', parent, callable, callable ? [init] : []);
                    const entry = entries[entries.length - 1];
                    entry.declarationContext = text.slice(node.getStart(sf), node.declarationList.declarations[0].getStart(sf));
                    // The engine can include const/let/export in a named arrow's
                    // container. Accept that complete statement only when it
                    // owns one declarator; keep the symbol's own slice intact.
                    if (callable && node.declarationList.declarations.length === 1) {
                        entry.engineRanges.push({ start: node.getStart(sf), end: decl.end },
                            { start: node.getStart(sf), end: node.end });
                    }
                    if (callable && ts.isBlock(init.body)) visit(init.body, name, true);
                }
            } else if (ts.isBlock(node) && declarationContext) {
                // Only direct nested declarations. Do not promote every
                // callback expression to its enclosing function's identity.
                for (const child of node.statements) {
                    if (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child) || ts.isVariableStatement(child)) visit(child, parent, true);
                }
            } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isEmptyStatement(node)) {
                // Preserved in document bytes and relation context; not symbols.
            } else if (!parent) {
                // This is the one intentional call-expression symbol form:
                // a top-level registerType with a literal identity and object
                // body. Do not generalize it to arbitrary callbacks/calls.
                const registration = registrationOf(node);
                if (registration) {
                    const qualified = add(node, registration.name, 'registration', null, true);
                    for (const member of registration.options.properties) {
                        if (!ts.isMethodDeclaration(member) && !ts.isGetAccessor(member) && !ts.isSetAccessor(member)) continue;
                        const memberName = staticMemberName(member);
                        if (!memberName) continue;
                        const kind = ts.isGetAccessor(member) ? 'getter' : ts.isSetAccessor(member) ? 'setter' : 'method';
                        const memberQualified = add(member, memberName, kind, qualified, true);
                        if (member.body) visit(member.body, memberQualified, true);
                    }
                } else {
                    exclusions.push({ path, start: node.getStart(sf), reason: ts.isModuleDeclaration(node) ? 'namespace-members-not-enumerated' : 'unmodeled-top-level-statement' });
                }
            } else {
                exclusions.push({ path, start: node.getStart(sf), reason: ts.isModuleDeclaration(node) ? 'namespace-members-not-enumerated' : 'unmodeled-top-level-statement' });
            }
        }
        for (const node of sf.statements) visit(node);
    }
    return { snapshotId, entries, documents, exclusions, parser: [...parsers].sort().join('; ') || 'none',
        scope: 'JS/TS named declarations, class members, direct nested declarations, and explicit top-level registerType registrations; Python named functions/classes including compound suites; callbacks/lambdas excluded' };
}

module.exports = { digest, inventorySnapshot, isSupportedSource };
