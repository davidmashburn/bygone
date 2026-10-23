const test = require('node:test');
const assert = require('node:assert/strict');

const { inventorySnapshot } = require('./symbol-inventory');
const { matchJavaScript } = require('./js-correspondence');

function compare(before, after, limits) {
    const inventories = {
        before: inventorySnapshot(before, 'before'),
        after: inventorySnapshot(after, 'after')
    };
    return { result: matchJavaScript(before, after, inventories, limits), inventories };
}

function mapperPairs(result, inventories) {
    const find = (side, span) => inventories[side].entries.find(entry => entry.path === span.path
        && entry.start === span.start && entry.end === span.end && entry.kind === span.kind && entry.name === span.name);
    return result.mappers.map(mapper => [find('before', mapper.source), find('after', mapper.destination)])
        .map(([source, destination]) => [source?.qualifiedName, destination?.qualifiedName]);
}

function entryIds(inventories, side, predicate) {
    return inventories[side].entries.filter(predicate).map(entry => entry.id);
}

test('matches an edited cross-file rename using declaration and body tokens', () => {
    const before = {
        'src/cart.js': `export function invoiceTotal(rows) {
  let total = 0;
  for (const row of rows) total += row.price * row.quantity;
  return total;
}
`,
        'src/markers.js': 'export function marker() { return "origin"; }\n'
    };
    const after = {
        'src/cart.js': 'export function marker() { return "origin"; }\n',
        'src/billing.mts': `export function subtotal(items) {
  let total = 5;
  for (const item of items) total += item.price * item.quantity;
  return total;
}
`
    };
    const { result, inventories } = compare(before, after);
    assert.equal(result.status, 'complete');
    assert.equal(result.mappers.length, 1);
    assert.deepEqual(mapperPairs(result, inventories), [['invoiceTotal', 'subtotal']]);
    assert.equal(result.mappers[0].category, 'inventory');
    assert.deepEqual(result.mappers[0].origins, ['continuation']);
    assert.deepEqual(result.mappers[0].mappings, []);
    assert.equal(result.mappers[0].source.text, before['src/cart.js'].slice(
        result.mappers[0].source.start, result.mappers[0].source.end));
    assert.equal(result.mappers[0].source.valid, true);
    assert.equal(result.mappers[0].destination.valid, true);
    assert.equal(result.mappers[0].match.strategy.includes('mutual'), true);
});

test('keeps duplicate renamed origins unresolved', () => {
    const body = 'export function calculate(rows) { return rows.map(row => row.price * row.quantity).join("|"); }\n';
    const { result, inventories } = compare(
        { 'a.js': body.replace('calculate', 'oldOne'), 'b.js': body.replace('calculate', 'oldTwo') },
        { 'c.js': body.replace('calculate', 'newOne'), 'd.js': body.replace('calculate', 'newTwo') });
    assert.equal(result.mappers.length, 0);
    const ambiguous = result.unresolved.filter(group => group.reason === 'ambiguous-js-candidates');
    assert.equal(ambiguous.length >= 1, true);
    const sourceIds = new Set(ambiguous.flatMap(group => group.sources));
    const destinationIds = new Set(ambiguous.flatMap(group => group.destinations));
    assert.deepEqual(sourceIds, new Set(entryIds(inventories, 'before', entry => entry.kind === 'function')));
    assert.deepEqual(destinationIds, new Set(entryIds(inventories, 'after', entry => entry.kind === 'function')));
});

test('retained origin remains a competitor for a copied destination', () => {
    const declaration = 'function helper(items) { return items.map(item => item.value + 1).filter(Boolean); }\n';
    const before = { 'a.js': declaration, 'b.js': declaration };
    const after = { 'a.js': declaration, 'c.js': declaration.replace('helper', 'copiedHelper') };
    const { result, inventories } = compare(before, after);
    const pairs = mapperPairs(result, inventories);
    assert(pairs.some(([source, destination]) => source === 'helper' && destination === 'helper'));
    assert.equal(pairs.some(([source, destination]) => source === 'helper' && destination === 'copiedHelper'), false);
    const copied = inventories.after.entries.find(entry => entry.name === 'copiedHelper');
    const origins = inventories.before.entries.filter(entry => entry.kind === 'function').map(entry => entry.id);
    assert(result.unresolved.some(group => group.reason === 'ambiguous-js-candidates'
        && group.destinations.includes(copied.id)
        && origins.every(id => group.sources.includes(id))));
});

test('rejects trivial cross-file function coincidence', () => {
    const { result } = compare(
        { 'old.js': 'export function oldName() { return 1; }\n' },
        { 'new.js': 'export function newName() { return 1; }\n' });
    assert.equal(result.mappers.length, 0);
    assert(result.rejectedCandidates.some(candidate => ['weak-coincidence', 'insufficient-evidence'].includes(candidate.reason)));
});

test('ignores comments and line endings while retaining operators and literals', () => {
    const before = { 'old.js': 'export function format(values) {\r\n  // old comment 😀\r\n  return values.map(value => value + 1).join("π");\r\n}\r\n' };
    const after = { 'new.jsx': 'export function render(items) {\n  /* unrelated comment */\n  return items.map(item => item - 2).join("π");\n}\n' };
    const { result } = compare(before, after);
    assert.equal(result.mappers.length, 1);
    assert.equal(result.mappers[0].match.bodySimilarity < 1, true);
    assert.equal(result.mappers[0].match.literalOrOperatorChanges >= 1, true);
});

test('does not guess from a malformed JavaScript document', () => {
    const before = { 'old.js': 'export function compute(value) { return value + 1; }\n' };
    const after = { 'new.js': 'export function compute(value) { return value + ; }\n' };
    const { result, inventories } = compare(before, after);
    assert.equal(result.mappers.length, 0);
    assert.notEqual(result.status, 'complete');
    assert.equal(result.processedPaths.after.includes('new.js'), false);
    assert.equal(inventories.after.documents[0].status, 'invalid');
});

test('does not anchor nested symbols through duplicate enclosing scopes', () => {
    const source = 'function outer() { function inner() { return values.reduce((a, b) => a + b, 0); } }\n'
        + 'function outer() { function inner() { return values.reduce((a, b) => a + b, 0); } }\n';
    const { result } = compare({ 'a.js': source }, { 'b.js': source.replaceAll('outer', 'renamedOuter') });
    assert.equal(result.mappers.length, 0);
    assert(result.unresolved.some(group => group.reason === 'ambiguous-js-candidates'));
});

test('preserves same-file ancestry across member reordering and distinguishes classes', () => {
    const before = {
        'classes.ts': `class Alpha {
  run() { return this.value + 1; }
  stop() { return this.value - 1; }
}
class Beta {
  run() { return this.value + 2; }
  stop() { return this.value - 2; }
}
`
    };
    const after = {
        'classes.ts': `class Alpha {
  stop() { return this.value - 1; }
  run() { return this.value + 1; }
}
class Beta {
  stop() { return this.value - 2; }
  run() { return this.value + 2; }
}
`
    };
    const { result, inventories } = compare(before, after);
    const pairs = mapperPairs(result, inventories);
    for (const name of ['Alpha', 'Alpha.run', 'Alpha.stop', 'Beta', 'Beta.run', 'Beta.stop']) {
        assert(pairs.some(([source, destination]) => source === name && destination === name), name);
    }
});

test('matches an edited registered container and its methods through the parent', () => {
    const before = {
        'query.js': `registerType("Query", {
  resolve(ctx) { return ctx.value + 1; },
  label() { return "π"; }
});
`
    };
    const after = {
        'result.js': `registerType("Result", {
  resolve(ctx) { return ctx.value + 2; },
  label() { return "π"; }
});
`
    };
    const { result, inventories } = compare(before, after);
    const pairs = mapperPairs(result, inventories);
    assert(pairs.some(([source, destination]) => source === 'Query' && destination === 'Result'));
    assert(pairs.some(([source, destination]) => source === 'Query.resolve' && destination === 'Result.resolve'));
    assert(pairs.some(([source, destination]) => source === 'Query.label' && destination === 'Result.label'));
});

test('matches noncallable variables and types across supported module extensions', () => {
    const before = {
        'config.cjs': `export const settings = { retries: 3, mode: "π", flags: [true, false] };\nexport type Settings = { retries: number; mode: string; };\n`
    };
    const after = {
        'config.mts': `export const options = { retries: 4, mode: "π", flags: [true, false] };\nexport type Options = { retries: number; mode: string; };\n`
    };
    const { result, inventories } = compare(before, after);
    const pairs = mapperPairs(result, inventories);
    assert(pairs.some(([source, destination]) => source === 'settings' && destination === 'options'));
    assert(pairs.some(([source, destination]) => source === 'Settings' && destination === 'Options'));
});

test('parses module and JSX/TSX extensions without widening the processed set', () => {
    const before = {
        'module.mjs': 'export function sourceMjs(value) { return value * 3 + 1; }\n',
        'values.cjs': 'export const sourceValue = { retries: 3, mode: "π", flags: [true, false] };\n',
        'types.mts': 'export type SourceType = { retries: number; mode: string; };\n',
        'classes.cts': 'export class SourceClass { run() { return this.value + 1; } }\n'
    };
    const after = {
        'module.tsx': 'export function targetTsx(value) { return value * 4 + 1; }\n',
        'values.mjs': 'export const targetValue = { retries: 4, mode: "π", flags: [true, false] };\n',
        'types.ts': 'export type TargetType = { retries: number; mode: string; };\n',
        'classes.jsx': 'export class TargetClass { run() { return this.value + 2; } }\n'
    };
    const { result, inventories } = compare(before, after);
    assert.equal(result.status, 'complete');
    const pairs = mapperPairs(result, inventories);
    assert(pairs.some(([source, destination]) => source === 'sourceMjs' && destination === 'targetTsx'));
    assert(pairs.some(([source, destination]) => source === 'sourceValue' && destination === 'targetValue'));
    assert(pairs.some(([source, destination]) => source === 'SourceType' && destination === 'TargetType'));
    assert(pairs.some(([source, destination]) => source === 'SourceClass' && destination === 'TargetClass'));
    assert.deepEqual(result.processedPaths.before, Object.keys(before).sort());
    assert.deepEqual(result.processedPaths.after, Object.keys(after).sort());
});

test('excludes Python from processed paths', () => {
    const { result } = compare(
        { 'a.py': 'def run():\n    return 1\n', 'a.js': 'export function run() { return 1 + 2; }\n' },
        { 'b.py': 'def run():\n    return 1\n', 'b.js': 'export function run() { return 1 + 2; }\n' });
    assert.deepEqual(result.processedPaths.before, ['a.js']);
    assert.deepEqual(result.processedPaths.after, ['b.js']);
});

test('budget exhaustion emits no inferred mappings', () => {
    const before = { 'a.js': 'export function first(value) { return value + 1; }\nexport function second(value) { return value + 2; }\n' };
    const after = { 'b.js': 'export function first(value) { return value + 1; }\nexport function second(value) { return value + 2; }\n' };
    const { result } = compare(before, after, { maxCandidates: 1 });
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.equal(result.mappers.length, 0);
    assert.match(result.reason, /candidate|budget/i);
});

test('is deterministic for the same snapshots and limits', () => {
    const before = { 'a.js': 'export function calculate(value) { return value * 3 + 1; }\n' };
    const after = { 'b.js': 'export function renamed(value) { return value * 4 + 1; }\n' };
    const first = compare(before, after).result;
    const second = compare(before, after).result;
    assert.deepEqual(second, first);
});

test('compares nested symbols only within their matched immediate parents', () => {
    const body = 'function inner(x) { return x.map(v => v.value + 1).join("a"); }';
    const before = { 'a.js': `function outer() { function left() { ${body} } function right() {} }` };
    const moved = { 'a.js': `function outer() { function left() {} function right() { ${body.replace('inner', 'renamed').replace('+ 1', '+ 2')} } }` };
    const movedResult = compare(before, moved);
    assert(!movedResult.result.mappers.some(m => m.source.name === 'inner'));
    const edited = compare(before, { 'a.js': before['a.js'].replace('+ 1', '+ 2') });
    assert(mapperPairs(edited.result, edited.inventories).some(([a, b]) => a === 'outer.left.inner' && b === a));
});

test('accepts a mutual best match with a sufficiently weaker viable runner-up', () => {
    const before = { 'a.js': 'function calculate(rows) { return rows.map(row => row.price * row.quantity).filter(Boolean).join("|"); }' };
    const after = { 'b.js': 'function total(rows) { return rows.map(row => row.price * row.quantity).filter(Boolean).join(";"); }\nfunction report(rows) { return rows.map(row => row.price + 1).join(","); }' };
    const { result, inventories } = compare(before, after);
    assert.deepEqual(mapperPairs(result, inventories), [['calculate', 'total']]);
    assert(result.mappers[0].match.runnerUp > 0.68);
    assert(result.mappers[0].match.score - result.mappers[0].match.runnerUp >= 0.08);
    assert(result.rejectedCandidates.some(c => c.reason === 'not-mutual-best'));
});

test('token and record exhaustion discard all inferred mappings', () => {
    const before = { 'a.js': 'function first(x) { return x + 1; }\nfunction second(x) { return x + 2; }' };
    const after = { 'a.js': before['a.js'].replace('+ 1', '+ 3').replace('+ 2', '+ 4') };
    for (const limits of [{ maxTokensPerSymbol: 5 }, { maxRecords: 1 }]) {
        const { result } = compare(before, after, limits);
        assert.equal(result.status, 'partial');
        assert.equal(result.truncated, true);
        assert.equal(result.mappers.length, 0);
    }
    for (const limits of [{ timeoutMs: 0 }, { maxCandidates: NaN }, { maxRecords: -1 }]) {
        assert.equal(compare(before, after, limits).result.reason, 'invalid-limits');
    }
});
