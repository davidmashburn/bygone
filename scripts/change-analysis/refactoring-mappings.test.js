const test = require('node:test');
const assert = require('node:assert/strict');
const { digest, inventorySnapshot } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');
const { analyzeWithBridge, compileBridge } = require('./run-refactoring-mappings');
const code = 'export function price(n) { return n + 1; }';
function span(path, text, name = 'price', start = 7) {
    return { path, start, end: text.length, valid: true, name, text: text.slice(start), sha256: digest(text.slice(start)) };
}
function mapper(a = code, b = code.replace('+ 1', '+ 2'), sourcePath = 'a.ts', destinationPath = 'b.ts') {
    return { id: 'm1', origins: ['continuation'], source: span(sourcePath, a), destination: span(destinationPath, b), mappings: [], unmappedBefore: [], unmappedAfter: [] };
}
const native = mappers => ({ status: 'complete', truncated: false, mappers });

test('JS inventory mappings validate exact full spans and kinds without borrowing native RM boundaries', () => {
    const before = { 'a.ts': 'const START_AT = new Date(0);' }, after = { 'a.ts': 'let START_AT = new Date(0);' };
    const inventories = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
    const fullSpan = (entry, files) => ({ ...entry, valid: true, text: files[entry.path].slice(entry.start, entry.end), sha256: entry.digest });
    const m = { id: 'js-1', category: 'inventory', origins: ['continuation'],
        source: fullSpan(inventories.before.entries[0], before), destination: fullSpan(inventories.after.entries[0], after),
        mappings: [], match: { strategy: 'scoped-structure', score: 1 } };
    const options = { inventories, engineProducer: 'bygone-strand' };
    const result = normalizeMappings(before, after, native([m]), options);
    assert.equal(result.relations.length, 1);
    assert.deepEqual(result.relations[0].producers, ['bygone-strand']);
    assert.equal(result.relations[0].declarationContextChanged, true);
    assert.equal(result.relations[0].evidence[0].match.strategy, 'scoped-structure');
    assert.equal(normalizeMappings(before, after, native([m]), { inventories }).relations.length, 0);
    const wrongKind = { ...m, destination: { ...m.destination, kind: 'function' } };
    assert.equal(normalizeMappings(before, after, native([wrongKind]), options).relations.length, 0);
    const truncated = normalizeMappings(before, after, { ...native([m]), truncated: true }, options);
    assert.equal(truncated.relations.length, 0);
    assert(truncated.unresolved.some(group => group.reason === 'incomplete-analysis'));
});

test('Strand rejects supplied cross-language inventory mappings in either direction', () => {
    const python = { 'a.py': 'def price(items):\n    return [item.cost + 1 for item in items]\n' };
    const javascript = { 'b.js': 'function price(items) { return items.map(item => item.cost + 1); }' };
    for (const [before, after] of [[python, javascript], [javascript, python]]) {
        const inventories = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
        const fullSpan = (entry, files) => ({ ...entry, valid: true, text: files[entry.path].slice(entry.start, entry.end), sha256: entry.digest });
        const m = { id: 'cross-language', category: 'inventory', origins: ['continuation'],
            source: fullSpan(inventories.before.entries.find(e => e.name === 'price'), before),
            destination: fullSpan(inventories.after.entries.find(e => e.name === 'price'), after), mappings: [] };
        const result = normalizeMappings(before, after, native([m]), { inventories, engineProducer: 'bygone-strand', exactFallback: false });
        assert.equal(result.relations.length, 0);
        assert.equal(result.status, 'partial');
        assert(result.rejected.some(r => r.reason === 'incompatible-container-language'));
    }
});

test('edited move exposes complete bytes and context, independent of engine-exact labels', () => {
    const next = code.replace('+ 1', '+ 2'), m = mapper(code, next);
    m.mappings = [{ source: m.source, destination: m.destination, engineExact: true }];
    const result = normalizeMappings({ 'a.ts': code }, { 'b.ts': next }, native([m]));
    assert.equal(result.relations.length, 1);
    const r = result.relations[0];
    assert.equal(r.rawEqual, false); assert.equal(r.behavior, 'unassessed');
    assert.equal(r.evidence[0].mappings[0].rawEqual, false);
    assert.equal(r.localDiff.filter(p => !p.added).map(p => p.value).join(''), code);
    assert.equal(r.localDiff.filter(p => !p.removed).map(p => p.value).join(''), next);
});

test('unavailable engine preserves independently enumerated symbols', () => {
    const r = analyzeWithBridge({ 'a.ts': code }, { 'a.ts': code.replace('+ 1', '* 2') });
    assert.equal(r.analysis.inventories.before.entries.length, 1);
    assert.equal(r.analysis.inventories.after.entries.length, 1);
    assert.equal(r.analysis.status, 'partial');
    assert.equal(r.native.reason, 'engine-not-configured');
    assert.equal(r.analysis.unmatchedBefore.length, 1);
});

test('explicit engine setup verifies bytes before execution and diagnoses a missing JDK', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-toolchain-test-'));
    const jar = path.join(root, 'engine.jar');
    fs.writeFileSync(jar, 'not an executable jar');
    const java = path.join(root, 'missing', 'java');
    try {
        assert.throws(() => compileBridge({ java, jar, expectedJarSha256: '0'.repeat(64) }), /engine-jar-digest-mismatch/);
        assert.throws(() => compileBridge({ java, jar, expectedJarSha256: digest(fs.readFileSync(jar)) }), /java-toolchain-unavailable:.*JDK 21\+.*ENOENT/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('duplicate origins remain unresolved while a unique retained binding can continue', () => {
    const duplicate = normalizeMappings({ 'a.ts': code, 'b.ts': code }, { 'c.ts': code }, native([]));
    assert.equal(duplicate.relations.length, 0); assert.equal(duplicate.unresolved.length, 1);
    const retained = normalizeMappings({ 'a.ts': code }, { 'a.ts': code, 'b.ts': code }, native([]));
    assert.equal(retained.relations.length, 1); assert.equal(retained.unresolved.length, 1);
    const kept = retained.inventories.after.entries.find(e => e.id === retained.relations[0].destinationId);
    assert.equal(kept.path, 'a.ts');
    assert.equal(retained.unmatchedAfter.length, 1);
    assert(retained.unresolved[0].competingSources.includes(retained.relations[0].sourceId));
    assert(retained.unresolved[0].competingDestinations.includes(kept.id));
    assert.equal(retained.unresolved[0].sources.length, 0);
});

test('repeated constants pair by unchanged file and binding despite shifted lines', () => {
    const constants = 'const START_AT = new Date(0);\nconst END_AT = new Date(1000);\n';
    const before = { 'a.js': constants, 'b.js': constants };
    const after = { 'a.js': 'const added = () => 1;\n' + constants, 'b.js': constants };
    const r = normalizeMappings(before, after, native([]));
    const entries = new Map([...r.inventories.before.entries, ...r.inventories.after.entries].map(e => [e.id, e]));
    assert.equal(r.relations.length, 4); assert.equal(r.unresolved.length, 0);
    assert(r.relations.every(p => p.rawEqual && !p.pathChanged && !p.nameChanged
        && entries.get(p.sourceId).path === entries.get(p.destinationId).path));
    assert.deepEqual(r.unmatchedAfter.map(id => entries.get(id).name), ['added']);
    assert.equal(r.unmatchedDiagnostics[0].reason, 'no-candidate-supplied');
    assert.equal(normalizeMappings(before, after, native([]), { exactFallback: false }).relations.length, 0);
});

test('nested exact declarations continue only at unique matching scope identities', () => {
    const before = { 'a.js': 'class A { run() { return 1; } }\nclass B { run() { return 1; } }' };
    const after = { 'a.js': 'class A { run() { return 1; } extra() {} }\nclass B { run() { return 1; } extra() {} }' };
    const r = normalizeMappings(before, after, native([]));
    const entries = new Map([...r.inventories.before.entries, ...r.inventories.after.entries].map(e => [e.id, e]));
    assert.equal(r.relations.length, 2); assert.equal(r.unresolved.length, 0);
    for (const pair of r.relations) assert.equal(entries.get(pair.sourceId).qualifiedName, entries.get(pair.destinationId).qualifiedName);
    const ambiguous = 'function outer() { function inner() { return 1; } }\nfunction outer() { function inner() { return 1; } }';
    const duplicates = normalizeMappings({ 'a.js': ambiguous }, { 'a.js': ambiguous }, native([]));
    assert.equal(duplicates.relations.length, 0);
    assert.equal(duplicates.unresolved.length, 2);
});

test('duplicate variables report competing origins and retained copies cannot fabricate moves', () => {
    const constant = 'const START_AT = new Date(0);';
    const r = normalizeMappings({ 'a.js': constant, 'b.js': constant }, { 'a.js': constant, 'c.js': constant }, native([]));
    assert.equal(r.relations.length, 1); assert.equal(r.relations[0].pathChanged, false);
    assert.equal(r.unresolved.length, 1);
    assert.equal(r.unresolved[0].sources.length, 1); assert.equal(r.unresolved[0].destinations.length, 1);
    assert.equal(r.unresolved[0].competingSources.length, 2); assert.equal(r.unresolved[0].competingDestinations.length, 2);
    assert.equal(r.unmatchedBefore.length, 1); assert.equal(r.unmatchedAfter.length, 1);
    assert(r.unmatchedDiagnostics.every(d => d.reason === 'ambiguous-symbol'));
    const bindingChanged = normalizeMappings({ 'a.js': constant }, { 'a.js': constant.replace('const ', 'let ') }, native([]));
    assert.equal(bindingChanged.relations.length, 0);
});

test('local exact evidence does not override a conflicting engine continuation', () => {
    const r = normalizeMappings({ 'a.ts': code }, { 'a.ts': code, 'b.ts': code }, native([mapper(code, code)]));
    assert.equal(r.relations.length, 0);
    assert.equal(r.unresolved.filter(g => g.reason === 'conflicting-continuations').length, 2);
});

test('unchanged engine omissions allow unique local edited continuations and clear duplicate-origin groups', () => {
    const edited = code.replace('+ 1', '+ 2');
    const r = normalizeMappings({ 'a.ts': code, 'b.ts': code, 'c.ts': edited, 'd.ts': edited },
        { 'a.ts': code, 'b.ts': edited, 'c.ts': code, 'd.ts': edited }, { ...native([
            mapper(code, edited, 'b.ts', 'b.ts'), mapper(edited, code, 'c.ts', 'c.ts')
        ]), processedPaths: { before: ['b.ts', 'c.ts'], after: ['b.ts', 'c.ts'] } });
    assert.equal(r.relations.length, 4);
    assert.equal(r.unresolved.length, 0);
    assert.equal(r.status, 'partial');
    assert.equal(r.issues.filter(i => i.reason === 'engine-skipped-document').length, 4);
});

test('skipped changed implementations still block local and cross-file engine candidates', () => {
    for (const destinationPath of ['a.ts', 'b.ts']) {
        const edited = code.replace('+ 1', '+ 2');
        const r = normalizeMappings({ 'a.ts': code, 'other.ts': code }, { [destinationPath]: edited },
            { ...native([mapper(code, edited, 'a.ts', destinationPath)]), processedPaths: { before: ['a.ts'], after: [destinationPath] } });
        assert.equal(r.relations.length, 0);
        assert(r.unresolved.some(g => g.reason === 'incomplete-analysis'));
    }
});

test('unchanged omitted implementations remain competitors for edited moves', () => {
    const edited = code.replace('+ 1', '+ 2');
    const r = normalizeMappings({ 'a.ts': code, 'retained.ts': code }, { 'b.ts': edited, 'retained.ts': code },
        { ...native([mapper(code, edited)]), processedPaths: { before: ['a.ts'], after: ['b.ts'] } });
    assert.equal(r.relations.length, 1);
    assert.deepEqual(r.relations[0].producers, ['exact-declaration']);
    assert(r.unresolved.some(g => g.reason === 'incomplete-analysis'));
});

test('unsearched endpoints and duplicate local identities cannot claim complete engine evidence', () => {
    const edited = code.replace('+ 1', '+ 2');
    const unsearched = normalizeMappings({ 'a.ts': code }, { 'a.ts': edited },
        { ...native([mapper(code, edited, 'a.ts', 'a.ts')]), processedPaths: { before: [], after: ['a.ts'] } });
    assert.equal(unsearched.relations.length, 0);
    const r = normalizeMappings({ 'a.ts': code + '\n' + code, 'retained.ts': code },
        { 'a.ts': edited + '\n' + edited, 'retained.ts': code },
        { ...native([mapper(code, edited, 'a.ts', 'a.ts')]), processedPaths: { before: ['a.ts'], after: ['a.ts'] } }, { exactFallback: false });
    assert.equal(r.relations.length, 0);
    assert(r.unresolved.some(g => g.reason === 'incomplete-analysis'));
});

test('a unique child cannot bypass a duplicated enclosing identity in a partial search', () => {
    const inner = 'function inner() { return 1; }', edited = inner.replace('1', '2');
    const text = `function outer() { ${inner} }\nfunction outer() {}`;
    const next = text.replace(inner, edited);
    const innerSpan = (text, declaration) => ({ path: 'a.ts', start: text.indexOf(declaration),
        end: text.indexOf(declaration) + declaration.length, text: declaration, sha256: digest(declaration), valid: true });
    const m = { ...mapper(), source: innerSpan(text, inner), destination: innerSpan(next, edited) };
    const r = normalizeMappings({ 'a.ts': text, 'retained.ts': code }, { 'a.ts': next, 'retained.ts': code },
        { ...native([m]), processedPaths: { before: ['a.ts'], after: ['a.ts'] } }, { exactFallback: false });
    assert.equal(r.relations.length, 0);
    assert(r.unresolved.some(group => group.reason === 'incomplete-analysis'));
});

test('conflicting engine continuations remain unresolved', () => {
    const after = code.replace('+ 1', '+ 2');
    const r = normalizeMappings({ 'a.ts': code }, { 'b.ts': after, 'c.ts': after }, native([mapper(code, after), mapper(code, after, 'a.ts', 'c.ts')]));
    assert.equal(r.relations.length, 0);
    assert.equal(r.unresolved.filter(x => x.reason === 'conflicting-continuations').length, 2);
});

test('parse preflight overrides success and prevents source loss from masquerading as absence', () => {
    const r = analyzeWithBridge({ 'a.ts': code }, { 'b.ts': 'export function price( {' });
    assert.equal(r.native.reason, 'parse-preflight-failed');
    assert.equal(r.analysis.status, 'partial'); assert.equal(r.analysis.relations.length, 0);
    assert.equal(r.analysis.inventories.after.documents[0].status, 'invalid');
    assert.equal(r.analysis.inventories.before.entries.length, 1);
});

test('corrupt offsets or digests are rejected, rather than repaired by a plausible name', () => {
    const m = mapper(); m.destination.sha256 = digest('different text');
    const r = normalizeMappings({ 'a.ts': code }, { 'b.ts': code.replace('+ 1', '+ 2') }, native([m]));
    assert.equal(r.relations.length, 0); assert.equal(r.rejected.length, 1);
    assert.equal(r.status, 'partial');
});

test('a mapper for an inner lambda cannot claim its enclosing function', () => {
    const text = 'export function price(n) { return [n].map(x => x + 1); }';
    const m = mapper(text, text); const start = text.indexOf('x =>'), end = text.indexOf(');');
    for (const side of ['source', 'destination']) m[side] = { ...m[side], start, end, text: text.slice(start, end), sha256: digest(text.slice(start, end)) };
    const r = normalizeMappings({ 'a.ts': text }, { 'b.ts': text }, native([m]), { exactFallback: false });
    assert.equal(r.relations.length, 0); assert.equal(r.rejected.length, 1);
    assert.ok(r.rejected[0].endpoints.every(e => e.reason === 'container-boundary-mismatch'));
    assert.ok(r.unmatchedDiagnostics.every(e => e.reason === 'no-candidate-supplied'));
});

test('extraction evidence stays grouped without consuming the old container as a continuation', () => {
    const m = mapper(); m.origins = ['extract'];
    const r = normalizeMappings({ 'a.ts': code }, { 'b.ts': code.replace('+ 1', '+ 2') }, native([m]));
    assert.equal(r.relations.length, 0); assert.equal(r.groups[0].kind, 'extract');
    assert.equal(r.groups[0].behavior, 'unassessed'); assert.equal(r.unmatchedBefore.length, 1);
});

test('truncation does not promote a partially searched engine candidate', () => {
    const r = normalizeMappings({ 'a.ts': code }, { 'b.ts': code.replace('+ 1', '+ 2') }, { status: 'partial', truncated: true, mappers: [mapper()] });
    assert.equal(r.relations.length, 0); assert.equal(r.unresolved[0].reason, 'incomplete-analysis');
});

test('inventory handles classes, arrows, anonymous defaults, overloads and explicit exclusions', () => {
    const files = { 'a.ts': 'interface I { run(): void }\ntype T = string;\nclass C { run(n: number) { return n; } }\nexport const arrow = (n: number) => n;\nexport default function(n: number) { return n; }\nfunction f(n: string): string;\nfunction f(n: string) { return n; }\nregisterType("Query", {});\nunknownCallback("Query", () => 1);' };
    const inv = inventorySnapshot(files, 'before');
    assert(inv.entries.some(e => e.kind === 'interface')); assert(inv.entries.some(e => e.kind === 'type'));
    assert(inv.entries.some(e => e.qualifiedName === 'C.run')); assert(inv.entries.some(e => e.name === 'default'));
    assert.equal(inv.entries.filter(e => e.name === 'f').length, 2);
    assert(inv.exclusions.some(e => e.reason === 'unmodeled-top-level-statement'));
    const reversed = inventorySnapshot(Object.fromEntries(Object.entries(files).reverse()), 'before');
    assert.deepEqual(inv.entries, reversed.entries);
});

test('UTF-16 ranges preserve emoji, CRLF and full declarations', () => {
    const a = '/* 📦 */\r\nexport function price(n) { return "💶" + n; }\r\n';
    const b = a.replace('💶', '💷');
    const begin = a.indexOf('function'), end = a.lastIndexOf('}') + 1;
    const m = { ...mapper(), source: { path: 'a.ts', start: begin, end, valid: true, name: 'price', text: a.slice(begin, end), sha256: digest(a.slice(begin, end)) },
        destination: { path: 'b.ts', start: begin, end, valid: true, name: 'price', text: b.slice(begin, end), sha256: digest(b.slice(begin, end)) } };
    const r = normalizeMappings({ 'a.ts': a }, { 'b.ts': b }, native([m]));
    assert.equal(r.relations.length, 1); assert.equal(r.relations[0].rawEqual, false);
});

test('limits fail explicitly before an unbounded parse or engine execution', () => {
    const r = analyzeWithBridge({ 'a.ts': code }, { 'b.ts': code }, { limits: { maxBytes: 4 } });
    assert.equal(r.analysis.status, 'unavailable'); assert.equal(r.analysis.reason, 'comparison-byte-budget');
    assert.equal(r.analysis.inventories, null);
});


test('a class continuation preserves changes across the full class, including nested method edits', () => {
    const a = 'export class Prices { run(n) { return n + 1; } }';
    const b = a.replace('+ 1', '+ 2');
    const source = span('a.ts', a, 'a.Prices'), destination = span('b.ts', b, 'b.Prices');
    const r = normalizeMappings({ 'a.ts': a }, { 'b.ts': b }, { status: 'complete', mappers: [], classMappings: [{ id: 'class-1', source, destination }] });
    assert.equal(r.relations.length, 1); assert.equal(r.relations[0].rawEqual, false);
    assert(r.relations[0].localDiff.some(p => p.added && p.value.includes('+ 2')));
});


test('empty supported scope reports unavailable rather than complete evidence', () => {
    const r = analyzeWithBridge({}, {});
    assert.equal(r.analysis.status, 'unavailable');
    assert.equal(r.analysis.engine.reason, 'no-supported-documents');
    assert.equal(r.analysis.relations.length, 0);
});

test('single arrow declarations bind complete engine statements with const/export context', () => {
    const a = 'export const price = n => n + 1;';
    const b = a.replace('+ 1', '+ 2');
    const statement = (path, text) => ({ path, name: 'price', start: 7, end: text.length - 1,
        valid: true, text: text.slice(7, -1), sha256: digest(text.slice(7, -1)) });
    const m = { ...mapper(), source: statement('a.js', a), destination: statement('b.js', b) };
    const r = normalizeMappings({ 'a.js': a }, { 'b.js': b }, native([m]));
    assert.equal(r.relations.length, 1);
    assert.equal(r.relations[0].rawEqual, false);
    assert(r.relations[0].producers.includes('refactoring-miner'));
    assert.equal(r.relations[0].localDiff.filter(p => !p.added).map(p => p.value).join(''), 'price = n => n + 1');
    const multi = 'const price = n => n + 1, tax = n => n * 2;';
    const invalid = statement('a.js', multi); invalid.start = 0; invalid.text = multi.slice(0, -1); invalid.sha256 = digest(invalid.text);
    const competing = normalizeMappings({ 'a.js': multi }, { 'b.js': b }, native([{ ...m, source: invalid }]), { exactFallback: false });
    assert.equal(competing.relations.length, 0);
});

test('Python independently inventories decorated async/class/nested suites with exact Unicode CRLF slices', () => {
    const code = '# 😀\r\n@(\r\n    register("π")\r\n)\r\nasync def café(n):\r\n    if n:\r\n        def inner():\r\n            return "😀"\r\n    return n  # final 😀\r\n    # suite comment\r\n\r\n# outside\r\n';
    const a = inventorySnapshot({ 'a.py': code, 'types.pyi': 'class Box:\n    def price(self, n: int) -> int: ...\n' }, 'before');
    assert(a.documents.every(d => d.status === 'complete'));
    assert.match(a.parser, /^cpython@/);
    const outer = a.entries.find(e => e.name === 'café');
    assert.equal(code.slice(outer.start, outer.end), code.slice(code.indexOf('@('), code.indexOf('\r\n\r\n# outside')));
    assert.equal(outer.startLine, 1); assert.equal(outer.endLine, 10);
    const inner = a.entries.find(e => e.name === 'inner');
    assert.equal(inner.qualifiedName, 'café.inner');
    assert.equal(code.slice(inner.start, inner.end), 'def inner():\r\n            return "😀"');
    assert(a.entries.some(e => e.qualifiedName === 'Box.price' && e.kind === 'method'));
});

test('Python parser never executes source and reports excluded bindings/lambdas', () => {
    const a = inventorySnapshot({ 'a.py': 'raise RuntimeError("must not execute")\n@fail()\ndef safe():\n    return 1\nhandler = lambda x: x\n' }, 'before');
    assert.equal(a.documents[0].status, 'complete');
    assert.equal(a.entries[0].name, 'safe');
    assert(a.exclusions.some(e => e.reason === 'python-lambda-not-inventoried'));
    assert(a.exclusions.some(e => e.reason === 'python-binding-not-inventoried'));
});

test('Python parse failures and missing/bounded runtimes cannot promote engine matches or exact fallback', () => {
    for (const options of [{ python: '/nonexistent/bygone-python' }, { pythonTimeoutMs: 1 }, { pythonMaxOutputBytes: 1 }]) {
        const a = normalizeMappings({ 'a.py': 'def price():\n    return 1\n' }, { 'a.py': 'def price():\n    return 1\n' }, { status: 'complete', mappers: [] }, options);
        assert.equal(a.status, 'partial'); assert.equal(a.relations.length, 0);
        assert.equal(a.inventories.before.documents[0].status, 'invalid');
        assert(a.inventories.before.documents[0].diagnostics.length);
    }
    const invalid = inventorySnapshot({ 'a.py': 'def broken(:\n' }, 'before');
    assert.equal(invalid.documents[0].status, 'invalid'); assert.equal(invalid.entries.length, 0);
});

test('engine-skipped Python stubs remain explicitly partial with independent exact coverage', () => {
    const files = { 'types.pyi': 'def price(n: int) -> int: ...\n' };
    const a = normalizeMappings(files, files, { status: 'complete', mappers: [], processedPaths: { before: [], after: [] } });
    assert.equal(a.status, 'partial'); assert.equal(a.relations.length, 1);
    assert.deepEqual(a.relations[0].producers, ['exact-declaration']);
    assert.equal(a.issues.filter(i => i.reason === 'engine-skipped-document').length, 2);
});

test('stub omissions preserve edited implementation matches but never promote stub engine candidates', () => {
    const a = '@register\ndef price(n):\n    return n + 1\n';
    const b = a.replace('price', 'cost').replace('+ 1', '+ 2');
    const stub = 'def cost(n: int) -> int: ...\n';
    const pySpan = (path, text, name) => ({ path, name, start: 0, end: text.trimEnd().length, valid: true,
        text: text.trimEnd(), sha256: digest(text.trimEnd()) });
    const m = { ...mapper(), source: pySpan('a.py', a, 'price'), destination: pySpan('b.py', b, 'cost') };
    const nativeResult = { ...native([m]), processedPaths: { before: ['a.py'], after: ['b.py'] } };
    const r = normalizeMappings({ 'a.py': a }, { 'b.py': b, 'types.pyi': stub }, nativeResult);
    assert.equal(r.status, 'partial'); assert.equal(r.relations.length, 1);
    assert.deepEqual(r.relations[0].producers, ['refactoring-miner']);
    assert.equal(r.relations[0].pathChanged, true); assert.equal(r.relations[0].nameChanged, true);
    assert(r.issues.some(i => i.reason === 'engine-skipped-document' && i.path === 'types.pyi'));
    const toStub = { ...m, destination: pySpan('types.pyi', stub, 'cost') };
    const rejected = normalizeMappings({ 'a.py': a }, { 'types.pyi': stub },
        { ...native([toStub]), processedPaths: { before: ['a.py'], after: ['types.pyi'] } });
    assert.equal(rejected.relations.length, 0);
    assert(rejected.unresolved.some(g => g.reason === 'incomplete-analysis'));
});

test('mixed-language snapshots record both parsers without requiring Python for JS-only input', () => {
    const onlyJS = inventorySnapshot({ 'a.js': 'function price() { return 1; }' }, 'before', { python: '/nonexistent/bygone-python' });
    assert.equal(onlyJS.documents[0].status, 'complete'); assert.match(onlyJS.parser, /^typescript@/);
    const mixed = inventorySnapshot({ 'a.js': 'function price() { return 1; }', 'b.py': 'def cost():\n    return 2\n' }, 'after');
    assert(mixed.documents.every(d => d.status === 'complete'));
    assert(mixed.parser.includes('typescript@')); assert(mixed.parser.includes('cpython@'));
    assert.equal(mixed.entries.length, 2);
});
