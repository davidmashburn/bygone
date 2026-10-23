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

test('PHP edited bracketed namespace classes and methods retain Strand evidence across a file move', () => {
    const before = [
        '<?php',
        'namespace App {',
        '  class Cart {',
        '    const LIMIT = 9;',
        '    private $value = 1;',
        '    function price($x) { return $x * 2 + 1; }',
        '  }',
        '}',
        ''
    ].join('\n');
    const after = before.replace('Cart', 'Basket').replace('LIMIT', 'MAX').replace('$value', '$amount')
        .replace('price', 'cost').replace('+ 1', '+ 2');
    const result = analyzeStrand({ 'old.php': before }, { 'new.php': after });
    assert.equal(result.analysis.status, 'complete');
    const pairs = relationPairs(result.analysis);
    assert(pairs.some(pair => pair[0] === 'App.Cart' && pair[1] === 'App.Basket'));
    assert(pairs.some(pair => pair[0] === 'App.Cart.price' && pair[1] === 'App.Basket.cost'));
    assert(result.analysis.relations.every(relation => relation.producers.includes('bygone-strand')));
    assert(result.analysis.relations.some(relation => !relation.rawEqual));
});

test('PHP namespaces, interfaces, traits, enums, fields, constants, and CRLF Unicode ranges retain ownership', () => {
    const text = [
        '<?php',
        '// 😀',
        'namespace App\\Core {',
        '  interface Reader { public function read(); }',
        '  trait Shared { protected $value; function useIt() { return "💡"; } }',
        '  enum Status: string { case Ready = "ready"; public function label() { return self::Ready->name; } }',
        '}',
        ''
    ].join('\r\n');
    const inventory = inventorySnapshot({ 'catalog.php': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.equal(inventory.documents[0].utf16Length, text.length);
    assert.deepEqual(inventory.entries.map(entry => [entry.qualifiedName, entry.kind]), [
        ['App\\Core', 'namespace'], ['App\\Core.Reader', 'interface'],
        ['App\\Core.Reader.read', 'method'], ['App\\Core.Shared', 'trait'],
        ['App\\Core.Shared.$value', 'property'], ['App\\Core.Shared.useIt', 'method'],
        ['App\\Core.Status', 'enum'], ['App\\Core.Status.Ready', 'constant'],
        ['App\\Core.Status.label', 'method']
    ]);
    for (const entry of inventory.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.digest, digest(text.slice(entry.start, entry.end)));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
        assert.deepEqual(entry.engineRanges[0], { start: entry.start, end: entry.end });
        assert.equal(entry.strandFeatures.version, 1);
    }
});

test('PHP bracketed and unbracketed namespace regions own declarations conservatively', () => {
    const text = [
        '<?php',
        'namespace Plain;',
        'class First {}',
        'function helper() {}',
        'namespace Block {',
        '  class Second {}',
        '  function blockHelper() {}',
        '}',
        'class GlobalAfter {}',
        ''
    ].join('\n');
    const inventory = inventorySnapshot({ 'regions.php': text }, 'before');
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => entry.qualifiedName), [
        'Plain', 'Plain.First', 'Plain.helper', 'Block', 'Block.Second',
        'Block.blockHelper', 'GlobalAfter'
    ]);
    assert.equal(inventory.entries.find(entry => entry.qualifiedName === 'Plain.First').parent, 'Plain');
    assert.equal(inventory.entries.find(entry => entry.qualifiedName === 'Block.Second').parent, 'Block');
    assert.equal(inventory.entries.find(entry => entry.qualifiedName === 'GlobalAfter').parent, null);
});

test('PHP local declarations, multiple fields/constants, closures, anonymous classes, and global namespace are excluded', () => {
    const text = [
        '<?php',
        'namespace App;',
        'class Box {',
        '  public $one, $two;',
        '  const A = 1, B = 2;',
        '  function run() {',
        '    $closure = function() { class Hidden { function leak() {} } };',
        '    $anonymous = new class { function anonymousLeak() {} };',
        '    function nested() {}',
        '  }',
        '}',
        'namespace { function root() {} class Root {} }',
        ''
    ].join('\n');
    const inventory = inventorySnapshot({ 'scopes.php': text }, 'before');
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => entry.qualifiedName), [
        'App', 'App.Box', 'App.Box.run'
    ]);
    for (const name of ['one', 'two', 'A', 'B', 'Hidden', 'leak', 'anonymousLeak', 'nested', 'Root', 'root']) {
        assert(!inventory.entries.some(entry => entry.name === name), name);
    }
    for (const reason of [
        'php-multiple-properties', 'php-multiple-constants', 'php-anonymous-closure',
        'php-anonymous-class', 'php-local-declaration', 'php-anonymous-namespace'
    ]) assert(inventory.exclusions.some(exclusion => exclusion.reason === reason), reason);
});

test('PHP unrelated owners and duplicate copies do not borrow method or field identity', () => {
    const before = {
        'a.php': [
            '<?php',
            'namespace App {',
            '  class Left { function price($x) { return $x * 9 + 1; } }',
            '  class Right {}',
            '}',
            ''
        ].join('\n')
    };
    const after = {
        'a.php': [
            '<?php',
            'namespace App {',
            '  class Left {}',
            '  class Right { function price($x) { return $x * 9 + 2; } }',
            '}',
            ''
        ].join('\n')
    };
    const moved = analyzeStrand(before, after);
    assert(!relationPairs(moved.analysis).some(pair => pair[0] === 'App.Left.price'));

    const copy = '<?php\nnamespace App { class Box { function price($x) { return $x * 9 + 1; } } }\n';
    const duplicate = analyzeStrand({ 'a.php': copy, 'b.php': copy }, { 'c.php': copy, 'd.php': copy });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.native.unresolved.length > 0);
});

test('PHP namespace identities block identical fallback across unrelated namespaces', () => {
    const before = {
        'before.php': [
            '<?php',
            'namespace First { class Box { function run($x) { return $x * 3 + 1; } } }',
            'namespace Second { class Box {} }',
            ''
        ].join('\n')
    };
    const after = {
        'after.php': [
            '<?php',
            'namespace First { class Box {} }',
            'namespace Second { class Box { function run($x) { return $x * 3 + 1; } } }',
            ''
        ].join('\n')
    };
    const beforeInventory = inventorySnapshot(before, 'before');
    const firstBox = beforeInventory.entries.find(entry => entry.qualifiedName === 'First.Box');
    const secondBox = beforeInventory.entries.find(entry => entry.qualifiedName === 'Second.Box');
    const firstRun = beforeInventory.entries.find(entry => entry.qualifiedName === 'First.Box.run');
    assert.notEqual(firstBox.scopeIdentity, secondBox.scopeIdentity);
    assert.equal(firstRun.scopeIdentity, firstBox.scopeIdentity);
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.status, 'complete');
    const afterInventory = inventorySnapshot(after, 'after');
    const afterSecondRun = afterInventory.entries.find(entry => entry.qualifiedName === 'Second.Box.run');
    assert.notEqual(firstRun.scopeIdentity, afterSecondRun.scopeIdentity);
    assert.equal(afterSecondRun.scopeIdentity, secondBox.scopeIdentity);
    assert(!relationPairs(result.analysis).some(([source, destination]) =>
        source === 'First.Box.run' && destination === 'Second.Box.run'));
    assert(!relationPairs(result.analysis).some(([source, destination]) =>
        source.split('.')[0] !== destination.split('.')[0] && source.endsWith('.Box')));
});

test('PHP malformed syntax fails closed before correspondence', () => {
    const invalid = analyzeStrand({ 'a.php': '<?php class Box { function ok() { return 1; } }' },
        { 'b.php': '<?php class Broken { function bad( {' });
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    assert.equal(invalid.analysis.relations.length, 0);
    assert.equal(invalid.analysis.inventories.after.entries.length, 0);
    assert.equal(invalid.analysis.inventories.after.documents[0].status, 'invalid');
});
