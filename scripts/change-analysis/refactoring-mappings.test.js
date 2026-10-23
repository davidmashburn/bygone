const test = require('node:test');
const assert = require('node:assert/strict');
const { digest, inventorySnapshot } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');
const { analyzeWithBridge } = require('./run-refactoring-mappings');
const code = 'export function price(n) { return n + 1; }';
function span(path, text, name = 'price', start = 7) {
    return { path, start, end: text.length, valid: true, name, text: text.slice(start), sha256: digest(text.slice(start)) };
}
function mapper(a = code, b = code.replace('+ 1', '+ 2'), sourcePath = 'a.ts', destinationPath = 'b.ts') {
    return { id: 'm1', origins: ['continuation'], source: span(sourcePath, a), destination: span(destinationPath, b), mappings: [], unmappedBefore: [], unmappedAfter: [] };
}
const native = mappers => ({ status: 'complete', truncated: false, mappers });

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

test('duplicates and retained origins never become arbitrary exact counterparts', () => {
    const duplicate = normalizeMappings({ 'a.ts': code, 'b.ts': code }, { 'c.ts': code }, native([]));
    assert.equal(duplicate.relations.length, 0); assert.equal(duplicate.unresolved.length, 1);
    const retained = normalizeMappings({ 'a.ts': code }, { 'a.ts': code, 'b.ts': code }, native([]));
    assert.equal(retained.relations.length, 0); assert.equal(retained.unresolved.length, 1);
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
    const files = { 'a.ts': 'interface I { run(): void }\ntype T = string;\nclass C { run(n: number) { return n; } }\nexport const arrow = (n: number) => n;\nexport default function(n: number) { return n; }\nfunction f(n: string): string;\nfunction f(n: string) { return n; }\nregisterType("Query", {});' };
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
