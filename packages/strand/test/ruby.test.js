const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot, digest } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

function relationPairs(analysis) {
    const before = new Map(analysis.inventories.before.entries.map(entry => [entry.id, entry]));
    const after = new Map(analysis.inventories.after.entries.map(entry => [entry.id, entry]));
    return analysis.relations.map(relation => [
        before.get(relation.sourceId).qualifiedName,
        after.get(relation.destinationId).qualifiedName
    ]);
}

const code = [
    'module Store',
    '  class Cart',
    '    def price(x)',
    '      subtotal = x * 9',
    '      subtotal += 1',
    '      subtotal',
    '    end',
    '    def self.build(x)',
    '      value = x * 2',
    '      value += 1',
    '      value',
    '    end',
    '  end',
    'end',
    ''
].join('\n');

test('Ruby edited classes and instance/self methods retain Strand correspondence across a file move', () => {
    const next = code.replace('Cart', 'Basket').replace('price', 'cost').replace('build', 'create')
        .replace('subtotal += 1', 'subtotal += 2').replace('value += 1', 'value += 2');
    const result = analyzeStrand({ 'old.rb': code }, { 'new.rb': next });
    assert.equal(result.analysis.status, 'complete');
    const pairs = relationPairs(result.analysis);
    assert(pairs.some(pair => pair[0] === 'Store.Cart' && pair[1] === 'Store.Basket'));
    assert(pairs.some(pair => pair[0] === 'Store.Cart.price' && pair[1] === 'Store.Basket.cost'));
    assert(pairs.some(pair => pair[0] === 'Store.Cart.build' && pair[1] === 'Store.Basket.create'));
    assert(result.analysis.relations.every(relation => relation.producers.includes('bygone-strand')));
    assert(result.analysis.relations.some(relation => !relation.rawEqual));
});

test('Ruby top-level defs map as private Object methods across a move and rename', () => {
    const before = [
        '# 😀',
        'def price(x)',
        '  subtotal = x * 9',
        '  subtotal + 1',
        'end',
        ''
    ].join('\r\n');
    const after = before.replace('price', 'cost').replace('subtotal + 1', 'subtotal + 2');
    const result = analyzeStrand({ 'old/price.rb': before }, { 'new/cost.rb': after });
    assert.equal(result.analysis.status, 'complete');
    const pairs = relationPairs(result.analysis);
    assert(pairs.some(pair => pair[0] === 'price' && pair[1] === 'cost'));
    const beforeEntry = result.analysis.inventories.before.entries.find(entry => entry.name === 'price');
    const afterEntry = result.analysis.inventories.after.entries.find(entry => entry.name === 'cost');
    assert.equal(beforeEntry.scopeIdentity, 'ruby-object-private-method');
    assert.equal(afterEntry.scopeIdentity, beforeEntry.scopeIdentity);
    assert(result.analysis.relations.every(relation => relation.producers.includes('bygone-strand')));
    assert(result.analysis.relations.some(relation => !relation.rawEqual));
});

test('Ruby named containers, constants, singleton scopes, and UTF-16 CRLF ranges stay owned', () => {
    const text = [
        '# 😀',
        'module Café',
        '  class Box',
        '    PRICE = "💡"',
        '    def value(n)',
        '      n + 1',
        '    end',
        '    def self.build(n)',
        '      new(n)',
        '    end',
        '    class << self',
        '      def from(n)',
        '        new(n)',
        '      end',
        '    end',
        '  end',
        'end',
        ''
    ].join('\r\n');
    const inventory = inventorySnapshot({ 'catalog.rb': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.equal(inventory.documents[0].utf16Length, text.length);
    assert.deepEqual(inventory.entries.map(entry => [entry.qualifiedName, entry.kind]), [
        ['Café', 'module'], ['Café.Box', 'class'], ['Café.Box.PRICE', 'constant'],
        ['Café.Box.value', 'method'], ['Café.Box.build', 'method'], ['Café.Box.from', 'method']
    ]);
    const value = inventory.entries.find(entry => entry.qualifiedName === 'Café.Box.value');
    const build = inventory.entries.find(entry => entry.qualifiedName === 'Café.Box.build');
    const from = inventory.entries.find(entry => entry.qualifiedName === 'Café.Box.from');
    assert.equal(value.scopeIdentity, 'ruby-instance-method');
    assert.equal(build.scopeIdentity, 'ruby-self-singleton-method');
    assert.equal(from.scopeIdentity, 'ruby-self-singleton-method');
    for (const entry of inventory.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.digest, digest(text.slice(entry.start, entry.end)));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
        assert.deepEqual(entry.engineRanges[0], { start: entry.start, end: entry.end });
        assert.equal(entry.strandFeatures.version, 1);
    }
});

test('Ruby local declarations, bindings, blocks, and dynamic receivers are explicit exclusions', () => {
    const text = [
        'class Box',
        '  VALUE = 1',
        '  def run(items)',
        '    local = 1',
        '    class Local',
        '      def leaked; 1; end',
        '    end',
        '    items.each { def block_leaked; 1; end }',
        '    lambda { def lambda_leaked; 1; end }',
        '  end',
        '  def receiver.dynamic(x); x; end',
        '  class << receiver',
        '    def dynamic_leaked; 1; end',
        '  end',
        '  define_method(:generated) { 1 }',
        '  class << self',
        '    def singleton_value(x)',
        '      value = x * 2',
        '      value + 1',
        '    end',
        '  end',
        'end',
        ''
    ].join('\n');
    const inventory = inventorySnapshot({ 'scopes.rb': text }, 'before');
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => entry.qualifiedName), [
        'Box', 'Box.VALUE', 'Box.run', 'Box.singleton_value'
    ]);
    for (const name of ['Local', 'leaked', 'block_leaked', 'lambda_leaked', 'dynamic', 'dynamic_leaked', 'generated']) {
        assert(!inventory.entries.some(entry => entry.name === name), name);
    }
    for (const reason of [
        'ruby-local-binding', 'ruby-local-declaration', 'ruby-anonymous-block',
        'ruby-dynamic-singleton-receiver'
    ]) assert(inventory.exclusions.some(exclusion => exclusion.reason === reason), reason);
});

test('Ruby owner isolation, scope collisions, reopenings, and duplicate copies stay conservative', () => {
    const before = {
        'a.rb': [
            'class Left',
            '  def price(x)',
            '    x * 9 + 1',
            '  end',
            'end',
            'class Right',
            'end',
            ''
        ].join('\n')
    };
    const after = {
        'a.rb': [
            'class Left',
            'end',
            'class Right',
            '  def price(x)',
            '    x * 9 + 2',
            '  end',
            'end',
            ''
        ].join('\n')
    };
    const moved = analyzeStrand(before, after);
    assert(!relationPairs(moved.analysis).some(pair => pair[0] === 'Left.price'));

    const scoped = inventorySnapshot({ 'scope.rb': 'class Box\n  def run; 1; end\n  def self.run; 1; end\nend\n' }, 'before');
    const runs = scoped.entries.filter(entry => entry.qualifiedName === 'Box.run');
    assert.equal(runs.length, 2);
    assert.deepEqual(new Set(runs.map(entry => entry.scopeIdentity)), new Set([
        'ruby-instance-method', 'ruby-self-singleton-method'
    ]));

    const reopened = inventorySnapshot({
        'reopen.rb': 'class Box\n  def run; 1; end\nend\nclass Box\n  def run; 2; end\nend\n'
    }, 'before');
    assert.equal(reopened.entries.filter(entry => entry.qualifiedName === 'Box').length, 2);
    assert.equal(reopened.entries.filter(entry => entry.qualifiedName === 'Box.run').length, 2);

    const duplicate = analyzeStrand({ 'a.rb': code, 'b.rb': code }, { 'c.rb': code, 'd.rb': code });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.native.unresolved.length > 0);
});

test('Ruby malformed syntax fails closed before correspondence', () => {
    const invalid = analyzeStrand({ 'a.rb': code }, { 'b.rb': 'class Broken\n  def bad(\n' });
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    assert.equal(invalid.analysis.relations.length, 0);
    assert.equal(invalid.analysis.inventories.after.entries.length, 0);
    assert.equal(invalid.analysis.inventories.after.documents[0].status, 'invalid');
});
