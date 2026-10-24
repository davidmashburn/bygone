const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('./symbol-inventory');

function pythonEntry(inventory, name, qualifiedName = name) {
    const entry = inventory.entries.find(candidate => candidate.path.endsWith('.py')
        && candidate.name === name && candidate.qualifiedName === qualifiedName);
    assert(entry, `missing Python entry ${qualifiedName}`);
    assert(entry.strandFeatures, `missing strand features for ${qualifiedName}`);
    return entry;
}

function tokens(entry, part) {
    return entry.strandFeatures[part].map(token => token.text);
}

function keys(entry, part) {
    return entry.strandFeatures[part].map(token => token.key);
}

function withoutFeatures(inventory) {
    return {
        ...inventory,
        entries: inventory.entries.map(({ strandFeatures: _strandFeatures, ...entry }) => entry)
    };
}

test('Python strand features are opt-in and leave default identity/ranges unchanged', () => {
    const files = { 'a.py': '@mark("x")\ndef price(value=1):\n    return value + 1\n' };
    const plain = inventorySnapshot(files, 'before');
    const featured = inventorySnapshot(files, 'before', { strandFeatures: true });

    assert(plain.entries.every(entry => !entry.strandFeatures));
    assert.deepEqual(withoutFeatures(featured), plain);
    assert.equal(featured.entries.length, 1);
});

test('Python stubs retain inventory-only parsing when Strand features are requested', () => {
    const files = { 'types.pyi': 'def price(value: int = ...) -> int: ...\n' };
    const plain = inventorySnapshot(files, 'before');
    const featured = inventorySnapshot(files, 'before', { strandFeatures: true });
    assert.equal(featured.entries.length, 1);
    assert.deepEqual(featured, plain);
});

test('Python features ignore whitespace/comments and omit only the declaration name from headers', () => {
    const before = [
        '@decorate(outer)\n',
        'def outer(value=outer):\n',
        '    # ignored comment\n',
        '    return value + 1\n'
    ].join('');
    const after = [
        '# leading comment\n',
        '@decorate ( outer )\n',
        'def outer ( value = outer ) :  # trailing comment\n',
        '\n',
        '        return value+1\n'
    ].join('');
    const left = pythonEntry(inventorySnapshot({ 'before.py': before }, 'before', { strandFeatures: true }), 'outer');
    const right = pythonEntry(inventorySnapshot({ 'after.py': after }, 'after', { strandFeatures: true }), 'outer');

    assert.deepEqual(left.strandFeatures, right.strandFeatures);
    assert.equal(keys(left, 'headerTokens').filter(key => key === 'identifier:outer').length, 2);
    assert.equal(tokens(left, 'headerTokens').includes('outer'), true);
    assert.equal(tokens(left, 'headerTokens').filter(text => text === 'outer').length, 2);
});

test('Python features preserve decorator, literal, and operator spelling changes', () => {
    const before = '@decorate("old")\ndef compute(value=1):\n    return value + 1\n';
    const after = '@decorate("new")\ndef compute(value=2):\n    return value - 3\n';
    const left = pythonEntry(inventorySnapshot({ 'a.py': before }, 'before', { strandFeatures: true }), 'compute');
    const right = pythonEntry(inventorySnapshot({ 'b.py': after }, 'after', { strandFeatures: true }), 'compute');

    assert(keys(left, 'headerTokens').includes('literal:"old"'));
    assert(keys(right, 'headerTokens').includes('literal:"new"'));
    assert(keys(left, 'bodyTokens').includes('operator:+'));
    assert(keys(right, 'bodyTokens').includes('operator:-'));
    assert(keys(left, 'bodyTokens').includes('literal:1'));
    assert(keys(right, 'bodyTokens').includes('literal:3'));
    assert.equal(left.strandFeatures.ast.Add, 1);
    assert.equal(right.strandFeatures.ast.Sub, 1);
});

test('Python features cover async, decorators, classes, nested declarations, and AST syntax kinds', () => {
    const source = [
        '@decorate(outer)\n',
        'async def outer(value=outer):\n',
        '    @nested_decorator\n',
        '    def nested(target):\n',
        '        return target\n',
        '    return value\n',
        '\n',
        'class Café(Base):\n',
        '    @property\n',
        '    def name(self):\n',
        '        return "😀"\n'
    ].join('');
    const inventory = inventorySnapshot({ 'a.py': source }, 'before', { strandFeatures: true });
    const outer = pythonEntry(inventory, 'outer');
    const nested = pythonEntry(inventory, 'nested', 'outer.nested');
    const café = pythonEntry(inventory, 'Café');
    const name = pythonEntry(inventory, 'name', 'Café.name');

    assert(keys(outer, 'headerTokens').includes('keyword:async'));
    assert(keys(outer, 'headerTokens').includes('keyword:def'));
    assert(keys(outer, 'headerTokens').includes('operator:@'));
    assert(keys(outer, 'bodyTokens').includes('operator:@'));
    assert(keys(outer, 'bodyTokens').includes('identifier:nested'));
    assert.equal(outer.strandFeatures.ast.AsyncFunctionDef, 1);
    assert.equal(outer.strandFeatures.ast.FunctionDef, 1);
    assert.equal('Name' in outer.strandFeatures.ast, false);
    assert.equal('Constant' in outer.strandFeatures.ast, false);
    assert.equal('Load' in outer.strandFeatures.ast, false);
    assert.equal(keys(nested, 'headerTokens').includes('identifier:nested'), false);
    assert.equal(keys(café, 'headerTokens').includes('identifier:Café'), false);
    assert.equal(keys(café, 'bodyTokens').includes('operator:@'), true);
    assert.equal(keys(name, 'headerTokens').includes('identifier:name'), false);
    assert.equal(keys(name, 'bodyTokens').includes('literal:"😀"'), true);
});

test('Python features preserve Unicode/CRLF source token text and exact declaration ranges', () => {
    const source = '# 😀\r\n@mark("π")\r\nasync def café(value):\r\n    return "😀" + value  # final\r\n';
    const inventory = inventorySnapshot({ 'a.py': source }, 'before', { strandFeatures: true });
    const entry = pythonEntry(inventory, 'café');

    assert.equal(source.slice(entry.start, entry.end), source.slice(source.indexOf('@mark'), source.length).trimEnd());
    assert.equal(entry.startLine, 1);
    assert.equal(keys(entry, 'headerTokens').includes('literal:"π"'), true);
    assert.equal(keys(entry, 'bodyTokens').includes('literal:"😀"'), true);
    assert.equal(keys(entry, 'bodyTokens').includes('operator:+'), true);
    assert.equal(keys(entry, 'headerTokens').includes('identifier:café'), false);
});

test('Python bad syntax remains invalid when strand features are requested', () => {
    const inventory = inventorySnapshot({ 'bad.py': 'def broken(:\r\n' }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'invalid');
    assert.equal(inventory.entries.length, 0);
    assert(inventory.documents[0].diagnostics.length > 0);
});

test('Python normalized declaration names preserve raw references in feature evidence', () => {
    const files = { 'a.py': '@mark(K)\ndef K(value=K):\n    return value + 1\n' };
    const plain = inventorySnapshot(files, 'before');
    const featured = inventorySnapshot(files, 'before', { strandFeatures: true });
    assert.equal(featured.documents[0].status, 'complete');
    assert.deepEqual(withoutFeatures(featured), plain);
    const entry = pythonEntry(featured, 'K');
    assert.equal(keys(entry, 'headerTokens').filter(key => key === 'identifier:K').length, 2);
});
