const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot, matchStrand } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

function relationPairs(analysis) {
    return analysis.relations.map(relation => [
        analysis.inventories.before.entries.find(entry => entry.id === relation.sourceId).qualifiedName,
        analysis.inventories.after.entries.find(entry => entry.id === relation.destinationId).qualifiedName
    ]);
}

function nativePairs(native) {
    return native.mappers.map(mapper => [mapper.source.name, mapper.destination.name]);
}

const rustInventoryFixture = [
    '// 😀\r\n',
    'mod café {\r\n',
    '    pub struct Crate { value: i32 }\r\n',
    '    pub enum Kind { A, B }\r\n',
    '    pub trait Render {\r\n',
    '        fn draw(&self);\r\n',
    '    }\r\n',
    '    impl Render for Crate {\r\n',
    '        fn draw(&self) {\r\n',
    '            let closure = |x: i32| { fn hidden() {} x + 1 };\r\n',
    '            helper_macro!();\r\n',
    '        }\r\n',
    '    }\r\n',
    '    type Alias = i32;\r\n',
    '    const π: i32 = 1;\r\n',
    '    static READY: bool = true;\r\n',
    '}\r\n',
    'macro_rules! helper_macro { () => { fn generated() {} }; }\r\n'
].join('');

test('Rust inventory preserves declaration ownership, exclusions, and Unicode CRLF ranges', () => {
    const inventory = inventorySnapshot({ 'src/lib.rs': rustInventoryFixture }, 'before', { strandFeatures: true });
    const document = inventory.documents.find(entry => entry.path === 'src/lib.rs');
    assert.equal(document.status, 'complete');

    const entries = new Map(inventory.entries.map(entry => [entry.qualifiedName, entry]));
    assert.deepEqual([...entries.keys()], [
        'café',
        'café.Crate',
        'café.Kind',
        'café.Render',
        'café.Render.draw',
        'café.impl Render for Crate',
        'café.impl Render for Crate.draw',
        'café.Alias',
        'café.π',
        'café.READY'
    ]);
    assert.equal(entries.get('café.Render.draw').kind, 'method');
    assert.equal(entries.get('café.impl Render for Crate').kind, 'impl');
    assert.equal(entries.get('café.impl Render for Crate.draw').parent, 'café.impl Render for Crate');
    assert.equal(entries.get('café.impl Render for Crate').name, 'impl Render for Crate');
    assert(entries.get('café.impl Render for Crate').strandFeatures.bodyTokens.length > 0);
    assert(entries.get('café.Render').strandFeatures.bodyTokens.length > 0);
    assert(entries.get('café.impl Render for Crate.draw').callable);
    assert.equal(entries.get('café').scopeIdentity, 'rust');
    assert.equal(entries.get('café.Render').scopeIdentity, 'trait Render');
    assert.equal(entries.get('café.Render.draw').scopeIdentity, 'trait Render');
    assert.equal(entries.get('café.impl Render for Crate').scopeIdentity, 'impl Render for Crate');
    assert.equal(entries.get('café.impl Render for Crate.draw').scopeIdentity, 'impl Render for Crate');

    for (const entry of inventory.entries) {
        assert(entry.scopeIdentity);
        assert.equal(rustInventoryFixture.slice(entry.start, entry.end).includes(entry.name), true);
        assert.equal(entry.startLine, rustInventoryFixture.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, rustInventoryFixture.slice(0, entry.end - 1).split('\n').length);
        assert.deepEqual(entry.engineRanges[0], { start: entry.start, end: entry.end });
        assert.equal(entry.strandFeatures.version, 1);
    }

    assert(inventory.exclusions.some(exclusion => exclusion.reason === 'rust-anonymous-closure'));
    assert(inventory.exclusions.some(exclusion => exclusion.reason === 'rust-macro-invocation-not-expanded'));
    assert(inventory.exclusions.some(exclusion => exclusion.reason === 'rust-macro-definition-not-expanded'));
    assert(!inventory.entries.some(entry => ['hidden', 'generated', 'helper_macro'].includes(entry.name)));
});

test('Rust moves, renames, and body edits retain impl ownership through public Strand APIs', () => {
    const before = {
        'old.rs': [
            'pub struct Cart { total: i32 }\n',
            'impl Cart {\n',
            '    fn price(&self, tax: i32) -> i32 {\n',
            '        self.total + tax\n',
            '    }\n',
            '}\n'
        ].join('')
    };
    const after = {
        'new.rs': [
            'pub struct Cart { total: i32 }\n',
            'impl Cart {\n',
            '    fn cost(&self, tax: i32) -> i32 {\n',
            '        self.total * tax + 1\n',
            '    }\n',
            '}\n'
        ].join('')
    };
    const beforeInventory = inventorySnapshot(before, 'before', { strandFeatures: true });
    const afterInventory = inventorySnapshot(after, 'after', { strandFeatures: true });
    const native = matchStrand(before, after, { before: beforeInventory, after: afterInventory });
    assert.equal(native.status, 'complete');
    assert(nativePairs(native).some(([source, destination]) => source === 'impl Cart' && destination === 'impl Cart'));
    assert(nativePairs(native).some(([source, destination]) => source === 'price' && destination === 'cost'));

    const { analysis } = analyzeStrand(before, after);
    assert.equal(analysis.status, 'complete');
    const pairs = relationPairs(analysis);
    assert(pairs.some(([source, destination]) => source === 'impl Cart' && destination === 'impl Cart'));
    assert(pairs.some(([source, destination]) => source === 'impl Cart.price' && destination === 'impl Cart.cost'));
    const movedMethod = analysis.relations.find(relation => {
        const [[source, destination]] = relationPairs({ ...analysis, relations: [relation] });
        return source === 'impl Cart.price' && destination === 'impl Cart.cost';
    });
    assert(movedMethod);
    assert.equal(movedMethod.pathChanged, true);
    assert.equal(movedMethod.nameChanged, true);
    assert.equal(movedMethod.rawEqual, false);
    assert(movedMethod.producers.includes('bygone-strand'));
});

test('Rust method correspondence cannot cross unrelated impl scopes', () => {
    const before = {
        'before.rs': [
            'impl Left {\n',
            '    fn run(&self, x: i32) -> i32 { self.value(x) + 1 }\n',
            '}\n',
            'impl Right {}\n'
        ].join('')
    };
    const after = {
        'after.rs': [
            'impl Left {}\n',
            'impl Right {\n',
            '    fn run(&self, x: i32) -> i32 { self.value(x) + 1 }\n',
            '}\n'
        ].join('')
    };
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.relations.length, 0);
    assert(!relationPairs(result.analysis).some(([source, destination]) =>
        source === 'impl Left.run' && destination === 'impl Right.run'));
});

test('Rust malformed syntax is unavailable and duplicate copies stay ambiguous', () => {
    const malformed = analyzeStrand(
        { 'before.rs': 'fn stable(x: i32) -> i32 { x + 1 }\n' },
        { 'after.rs': 'fn stable(x: i32) -> i32 {\n' }
    );
    assert.equal(malformed.analysis.relations.length, 0);
    assert.equal(malformed.native.reason, 'parse-preflight-failed');
    assert.equal(malformed.analysis.inventories.after.documents[0].status, 'invalid');

    const copy = 'fn duplicate(value: i32) -> i32 {\n    value * 7 + 2\n}\n';
    const ambiguous = analyzeStrand(
        { 'left.rs': copy, 'right.rs': copy },
        { 'first.rs': copy, 'second.rs': copy }
    );
    assert.equal(ambiguous.analysis.relations.length, 0);
    assert(ambiguous.native.unresolved.some(group => group.reason === 'ambiguous-rust-candidates'));
});


test('Rust outer attribute edits belong to the exact declaration range and features', () => {
    const before = '// 😀\r\n#[inline]\r\n#[must_use]\r\npub fn cost(x: i32) -> i32 { x * 7 + 2 }\r\n';
    const after = before.replace('#[inline]', '#[inline(always)]');
    const result = analyzeStrand({ 'a.rs': before }, { 'a.rs': after });
    assert.equal(result.analysis.relations.length, 1);
    assert.equal(result.analysis.relations[0].rawEqual, false);
    const entry = result.analysis.inventories.before.entries[0];
    assert(before.slice(entry.start, entry.end).startsWith('#[inline]\r\n#[must_use]'));
    assert.equal(entry.startLine, 1);
    const inv = inventorySnapshot({ 'a.rs': before }, 'before', { strandFeatures: true });
    assert(inv.entries[0].strandFeatures.headerTokens.some(t => t.text === 'must_use'));
});
