const assert = require('node:assert/strict');
const { analyze } = require('./symbol-probe');
const f = 'export function total(items: number[]) { return items.reduce((a, b) => a + b, 0); }';
const cases = [
  ['module move', { 'a.ts': f }, { 'b.ts': f }, r => {
    assert.equal(r.matches.length, 1); assert.equal(r.matches[0].pathChanged, true);
  }],
  ['rename', { 'a.ts': f }, { 'a.ts': f.replace('total', 'sum') }, r => {
    assert.equal(r.matches.length, 1); assert.equal(r.matches[0].nameChanged, true);
  }],
  ['move and rename', { 'a.ts': f }, { 'b.ts': f.replace('total', 'sum') }, r => {
    assert.equal(r.matches.length, 1); assert.equal(r.matches[0].bodySyntaxEqual, true);
  }],
  ['move and literal edit abstains', { 'a.ts': f }, { 'b.ts': f.replace(', 0)', ', 1)') }, r => {
    assert.equal(r.matches.length, 0); assert.equal(r.unmatchedRight.length, 1);
  }],
  ['same name edited body', { 'a.ts': f }, { 'a.ts': f.replace('a + b', 'a - b') }, r => {
    assert.equal(r.matches[0].bodySyntaxEqual, false);
  }],
  ['duplicate sources', { 'a.ts': f, 'b.ts': f }, { 'c.ts': f }, r => {
    assert.equal(r.matches.length, 0); assert.equal(r.unresolved.length, 1);
  }],
  ['retained source and possible copy', { 'a.ts': f }, { 'a.ts': f, 'b.ts': f }, r => {
    assert.equal(r.matches.length, 1); assert.equal(r.unresolved.length, 1);
  }],
  ['format and comments are separate evidence', { 'a.ts': f }, { 'b.ts': f.replace('return', '/* changed docs */\n return') }, r => {
    assert.equal(r.matches.length, 1); assert.equal(r.matches[0].rawEqual, false);
  }],
  ['changed binding despite identical body', { 'a.ts': 'const rate = 1; export function cost() { return rate; }' },
    { 'b.ts': 'const rate = 2; export function cost() { return rate; }' }, r => {
      assert.equal(r.matches.length, 1); assert.equal(r.matches[0].behavior, 'unassessed');
    }],
  ['arrow function', { 'a.ts': 'const total = (n: number) => n + 1;' },
    { 'b.ts': 'const sum = (n: number) => n + 1;' }, r => { assert.equal(r.matches.length, 1); }],
  ['variable declaration mode remains visible', { 'a.ts': 'const total = () => 1;' },
    { 'a.ts': 'let total = () => 1;' }, r => {
      assert.equal(r.matches[0].declarationSyntaxEqual, false);
      assert.equal(r.matches[0].bodySyntaxEqual, true);
    }],
  ['invalid parse', { 'a.ts': f }, { 'b.ts': 'export function total( {' }, r => {
    assert.equal(r.status, 'partial'); assert.equal(r.matches.length, 0);
  }],
  ['unsupported class and registration', { 'a.ts': 'class A { run() {} } register("Query", () => 1);' }, {}, r => {
    assert.equal(r.inventory.before, 0); assert.equal(r.unsupported.before, 2);
  }]
];
for (const [name, before, after, check] of cases) {
  const result = analyze(before, after); check(result);
  for (const m of result.matches) assert.equal(m.behavior, 'unassessed');
  console.log(`PASS ${name}`);
}
console.log(`${cases.length} research scenarios passed`);
