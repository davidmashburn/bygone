const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

function relationPairs(analysis, predicate = () => true) {
    return analysis.relations
        .filter(predicate)
        .map(relation => [
            analysis.inventories.before.entries.find(entry => entry.id === relation.sourceId).qualifiedName,
            analysis.inventories.after.entries.find(entry => entry.id === relation.destinationId).qualifiedName
        ]);
}

test('Go renamed moved functions retain body evidence', () => {
    const before = {
        'old.go': 'package tally\n\nfunc Sum(values []int) int {\n\ttotal := 0\n\tfor _, value := range values { total += value }\n\treturn total + 1\n}\n'
    };
    const after = {
        'new.go': 'package tally\n\nfunc Total(values []int) int {\n\ttotal := 0\n\tfor _, value := range values { total += value }\n\treturn total + 2\n}\n'
    };
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.status, 'complete');
    assert.deepEqual(relationPairs(result.analysis, relation => {
        const source = result.analysis.inventories.before.entries.find(entry => entry.id === relation.sourceId);
        return source.kind === 'function';
    }), [['Sum', 'Total']]);
    assert(result.analysis.relations.every(relation => relation.producers.includes('bygone-strand')));
    assert(result.analysis.relations.some(relation => !relation.rawEqual));
});

test('Go methods normalize pointer/value receivers and never cross unrelated receiver types', () => {
    const before = {
        'old.go': [
            'package records', '',
            'type Left struct{}',
            'type Right struct{}', '',
            'type Box[T ~int] struct{}', '',
            'func (l *Left) Encode(value int) int { return value + 1 }',
            'func (Right) Encode(value int) int { return value + 1 }', '',
            'func (b *Box[T]) Render(value T) T { return value + value }', ''
        ].join('\n')
    };
    const after = {
        'new.go': [
            'package records', '',
            'type Left struct{}',
            'type Right struct{}', '',
            'type Box[T ~int] struct{}', '',
            'func (l Left) Encode(value int) int { return value + 2 }',
            'func (*Right) Encode(value int) int { return value + 1 }', '',
            'func (b Box[T]) Render(value T) T { return value + value }', ''
        ].join('\n')
    };
    const result = analyzeStrand(before, after);
    const pairs = relationPairs(result.analysis, relation => {
        const source = result.analysis.inventories.before.entries.find(entry => entry.id === relation.sourceId);
        return source.kind === 'method';
    });
    assert.deepEqual(pairs.sort(), [
        ['Box.Render', 'Box.Render'], ['Left.Encode', 'Left.Encode'], ['Right.Encode', 'Right.Encode']
    ]);
    assert(!pairs.some(([source, destination]) => source.split('.')[0] !== destination.split('.')[0]));
    assert(result.analysis.inventories.before.entries.filter(entry => entry.kind === 'method')
        .every(entry => entry.scopeIdentity === entry.name.split('.')[0]));
});

test('Go top-level const and var specs are bounded and local bindings are excluded', () => {
    const text = [
        'package values', '',
        'const One = 1',
        'const (',
        '\tTwo = 2',
        '\tThree int = 3',
        ')',
        'var Ready = true',
        'var (',
        '\tName = "x"',
        '\tA, B int',
        ')',
        'func local() { const hidden = 1; var inner = 2; _ = hidden + inner }', ''
    ].join('\n');
    const inventory = inventorySnapshot({ 'values.go': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => [entry.qualifiedName, entry.kind]), [
        ['One', 'constant'], ['Two', 'constant'], ['Three', 'constant'],
        ['Ready', 'variable'], ['Name', 'variable'], ['local', 'function']
    ]);
    assert(inventory.entries.find(entry => entry.name === 'One').strandFeatures.bodyTokens.length > 0);
    assert(inventory.entries.find(entry => entry.name === 'Ready').strandFeatures.bodyTokens.length > 0);
    assert(!inventory.entries.some(entry => ['A', 'B', 'hidden', 'inner'].includes(entry.name)));
    assert(inventory.exclusions.some(exclusion => exclusion.reason === 'go-multiple-variable-names'));
    assert.equal(inventory.exclusions.filter(exclusion => exclusion.reason === 'go-local-binding').length, 2);
});

test('Go type specs inventory struct fields and interface methods under their owners', () => {
    const text = [
        'package catalog', '',
        'type Account struct {',
        '\tID string',
        '\tname string',
        '}', '',
        'type Reader interface {',
        '\tRead(p []byte) (n int, err error)',
        '\tClose() error',
        '}', ''
    ].join('\n');
    const inventory = inventorySnapshot({ 'catalog.go': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => [entry.qualifiedName, entry.kind]), [
        ['Account', 'type'], ['Account.ID', 'property'], ['Account.name', 'property'],
        ['Reader', 'type'], ['Reader.Read', 'method'], ['Reader.Close', 'method']
    ]);
    for (const entry of inventory.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name.split('.').at(-1)));
        assert.deepEqual(entry.engineRanges[0], { start: entry.start, end: entry.end });
    }
});

test('Go inventory preserves Unicode and CRLF declaration ranges exactly', () => {
    const text = [
        '// 📦\r\npackage catalog\r\n\r\n',
        'type Box struct {\r\n',
        '\tπ string\r\n',
        '}\r\n\r\n',
        'func (b *Box) Café(n int) int { return n + len("💡") }\r\n'
    ].join('');
    const inventory = inventorySnapshot({ 'unicode.go': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    const box = inventory.entries.find(entry => entry.qualifiedName === 'Box');
    const field = inventory.entries.find(entry => entry.qualifiedName === 'Box.π');
    const method = inventory.entries.find(entry => entry.qualifiedName === 'Box.Café');
    assert(box && field && method);
    assert.equal(text.slice(box.start, box.end), 'Box struct {\r\n\tπ string\r\n}');
    assert.equal(text.slice(field.start, field.end), 'π string');
    assert.equal(text.slice(method.start, method.end), 'func (b *Box) Café(n int) int { return n + len("💡") }');
    for (const entry of inventory.entries) {
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
    }
});

test('Go malformed syntax stays invalid and unclear receivers are excluded', () => {
    const malformed = inventorySnapshot({ 'bad.go': 'package broken\n\nfunc broken(\r\n' }, 'before', { strandFeatures: true });
    assert.equal(malformed.documents[0].status, 'invalid');
    assert.equal(malformed.entries.length, 0);

    const unknownReceiver = inventorySnapshot({
        'unknown.go': 'package broken\n\nfunc (value pkg.Unknown) Hidden() {}\n'
    }, 'before', { strandFeatures: true });
    assert.equal(unknownReceiver.documents[0].status, 'complete');
    assert.equal(unknownReceiver.entries.some(entry => entry.name === 'pkg.Unknown.Hidden'), false);
    assert(unknownReceiver.exclusions.some(exclusion => exclusion.reason === 'go-unknown-receiver'));

    const analysis = analyzeStrand(
        { 'a.go': 'package broken\nfunc ok() { return }\n' },
        { 'b.go': 'package broken\nfunc broken(\n' }
    );
    assert.equal(analysis.native.reason, 'parse-preflight-failed');
    assert.equal(analysis.analysis.relations.length, 0);
});

test('Go has no cross-language matches and duplicate copies remain ambiguous', () => {
    const go = 'package mixed\nfunc Price(items []int) int { return len(items) + 1 }\n';
    const js = 'function Price(items) { return items.length + 1; }';
    const crossLanguage = analyzeStrand({ 'a.go': go }, { 'b.js': js });
    assert.equal(crossLanguage.analysis.relations.length, 0);

    const duplicate = analyzeStrand({ 'a.go': go, 'b.go': go }, { 'c.go': go, 'd.go': go });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.native.unresolved.some(group => group.reason === 'ambiguous-go-candidates'));
});

test('Go blank identifiers are exclusions rather than named symbols or matches', () => {
    const text = 'package tally\nconst _ = 9\nvar _ = 2\ntype _ struct{}\nfunc _() {}\ntype Named struct { _ int }\n';
    const inv = inventorySnapshot({ 'a.go': text }, 'before');
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => e.name), ['Named']);
    assert.equal(inv.exclusions.filter(e => e.reason === 'go-blank-identifier').length, 5);
    const result = analyzeStrand({ 'a.go': 'package tally\nconst _ = 9\n' }, { 'b.go': 'package tally\nconst _ = 10\n' });
    assert.equal(result.analysis.relations.length, 0);
});
