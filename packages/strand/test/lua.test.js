const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot, digest } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');
const code = 'local function price(items)\n local total = 0\n for i, item in ipairs(items) do total = total + item * 9 + 1 end\n return total\nend';

test('Lua edited named function moves and renames share Strand evidence', () => {
    const result = analyzeStrand({ 'a.lua': code }, { 'b.lua': code.replace('price(', 'cost(').replace('+ 1', '+ 2') });
    assert.equal(result.analysis.status, 'complete');
    assert.equal(result.analysis.relations.length, 1);
    assert.equal(result.analysis.inventories.after.entries[0].name, 'cost');
    assert.equal(result.analysis.relations[0].rawEqual, false);
});

test('Lua named functions retain nesting and static table ownership with Unicode CRLF ranges', () => {
    const text = '-- 😀\r\nfunction outer(x)\r\n local function inner(y) return y * 3 end\r\n return inner(x)\r\nend\r\nfunction api.Cart:cost(x) return x * 9 end\r\nfunction api.count(x) return x + 2 end\r\n';
    const inv = inventorySnapshot({ 'a.lua': text }, 'before', { strandFeatures: true });
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => e.qualifiedName), ['outer', 'outer.inner', 'api.Cart:cost', 'api.count']);
    for (const entry of inv.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.digest, digest(text.slice(entry.start, entry.end)));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
    }
});

test('Lua blocks owner and colon/dot calling convention changes and local/global confusion', () => {
    for (const [before, after] of [
        ['function Left:cost(x) return x * 9 + 1 end', 'function Right:cost(x) return x * 9 + 2 end'],
        ['function Box:cost(x) return x * 9 + 1 end', 'function Box.cost(x) return x * 9 + 2 end'],
        [code, code.replace('local function', 'function')]
    ]) assert.equal(analyzeStrand({ 'a.lua': before }, { 'b.lua': after }).analysis.relations.length, 0);
});

test('Lua assignment forms and anonymous functions are explicitly excluded', () => {
    const inv = inventorySnapshot({ 'a.lua': 'local callback = function(x) return x end\napi.value = 9\nconsume(function(x) return x end)\n' + code }, 'before');
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => e.name), ['price']);
    for (const reason of ['lua-assignment-bindings', 'lua-local-bindings', 'lua-anonymous-function']) assert(inv.exclusions.some(e => e.reason === reason), reason);
});

test('Lua invalid input and duplicate copies cannot become confident relations', () => {
    const invalid = analyzeStrand({ 'a.lua': code }, { 'b.lua': 'function broken(' });
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    assert.equal(invalid.analysis.relations.length, 0);
    const duplicate = analyzeStrand({ 'a.lua': code, 'b.lua': code }, { 'c.lua': code, 'd.lua': code });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.native.unresolved.length > 0);
});
