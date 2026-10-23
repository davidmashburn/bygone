const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

function relationPairs(analysis) {
    return analysis.relations.map(relation => [
        analysis.inventories.before.entries.find(entry => entry.id === relation.sourceId).qualifiedName,
        analysis.inventories.after.entries.find(entry => entry.id === relation.destinationId).qualifiedName
    ]);
}

test('C# inventory supports declarations and preserves attributed Unicode CRLF ranges', () => {
    const text = [
        '// 😀\r\n',
        'namespace Demo.Core\r\n',
        '{\r\n',
        '    [Obsolete]\r\n',
        '    public record Café(int Id)\r\n',
        '    {\r\n',
        '        [A]\r\n',
        '        public int π { get; set; }\r\n',
        '        [B]\r\n',
        '        public Café() { }\r\n',
        '        [C]\r\n',
        '        public int Prix(int x) => x + Id;\r\n',
        '        public int field = 1;\r\n',
        '    }\r\n',
        '    public interface IThing { int Get(); }\r\n',
        '    public struct Point { public int X; }\r\n',
        '    public enum Kind { A, B = 2 }\r\n',
        '    public delegate void Handler(int x);\r\n',
        '}\r\n'
    ].join('');
    const inventory = inventorySnapshot({ 'a.cs': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => [entry.qualifiedName, entry.kind]), [
        ['Demo.Core', 'namespace'],
        ['Demo.Core.Café', 'record'],
        ['Demo.Core.Café.π', 'property'],
        ['Demo.Core.Café.Café', 'constructor'],
        ['Demo.Core.Café.Prix', 'method'],
        ['Demo.Core.Café.field', 'property'],
        ['Demo.Core.IThing', 'interface'],
        ['Demo.Core.IThing.Get', 'method'],
        ['Demo.Core.Point', 'struct'],
        ['Demo.Core.Point.X', 'property'],
        ['Demo.Core.Kind', 'enum'],
        ['Demo.Core.Kind.A', 'property'],
        ['Demo.Core.Kind.B', 'property'],
        ['Demo.Core.Handler', 'delegate']
    ]);

    const entries = new Map(inventory.entries.map(entry => [entry.qualifiedName, entry]));
    assert(text.slice(entries.get('Demo.Core.Café').start, entries.get('Demo.Core.Café').end)
        .startsWith('[Obsolete]\r\n    public record Café'));
    assert(text.slice(entries.get('Demo.Core.Café.π').start, entries.get('Demo.Core.Café.π').end)
        .startsWith('[A]\r\n        public int π'));
    assert(text.slice(entries.get('Demo.Core.Café.Café').start, entries.get('Demo.Core.Café.Café').end)
        .startsWith('[B]\r\n        public Café()'));
    assert(text.slice(entries.get('Demo.Core.Café.Prix').start, entries.get('Demo.Core.Café.Prix').end)
        .startsWith('[C]\r\n        public int Prix'));
    for (const entry of inventory.entries) {
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
        assert.deepEqual(entry.engineRanges[0], { start: entry.start, end: entry.end });
        assert.equal(entry.strandFeatures.version, 1);
    }
});

test('C# file-scoped namespaces own following siblings without leaking scope', () => {
    const text = [
        '// 😀\r\n',
        'using System;\r\n',
        'namespace FileScope.Layer;\r\n',
        '[A]\r\n',
        'public class One {\r\n',
        '    public int Run() => 1;\r\n',
        '}\r\n',
        'public struct Two { public int π; }\r\n'
    ].join('');
    const inventory = inventorySnapshot({ 'file.cs': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    const entries = new Map(inventory.entries.map(entry => [entry.qualifiedName, entry]));
    assert.deepEqual([...entries.keys()], [
        'FileScope.Layer', 'FileScope.Layer.One', 'FileScope.Layer.One.Run',
        'FileScope.Layer.Two', 'FileScope.Layer.Two.π'
    ]);
    assert.equal(text.slice(entries.get('FileScope.Layer').start, entries.get('FileScope.Layer').end),
        'namespace FileScope.Layer;');
    assert.equal(entries.get('FileScope.Layer.One').parent, 'FileScope.Layer');
    assert.equal(entries.get('FileScope.Layer.Two').parent, 'FileScope.Layer');
    assert.equal(entries.get('FileScope.Layer.One.Run').parent, 'FileScope.Layer.One');
    for (const entry of inventory.entries) assert.equal(entry.scopeIdentity, 'FileScope.Layer');
});

test('C# edited declarations moved between files retain owner-scoped correspondence', () => {
    const before = {
        'old/Cart.cs': 'namespace Shop { [A] public class Cart { [B] public int Price(int x) { return x * 2 + 1; } } }'
    };
    const after = {
        'new/Basket.cs': 'namespace Shop { [A] public class Basket { [B] public int Cost(int x) { return x * 2 + 2; } } }'
    };
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.status, 'complete');
    assert.deepEqual(relationPairs(result.analysis), [
        ['Shop', 'Shop'], ['Shop.Cart', 'Shop.Basket'], ['Shop.Cart.Price', 'Shop.Basket.Cost']
    ]);
    assert(result.analysis.relations.every(relation => relation.producers.includes('bygone-strand')));
    assert(result.analysis.relations.every(relation => !relation.rawEqual));
});

test('C# sibling namespaces cannot borrow same-named owners or methods', () => {
    const before = {
        'before.cs': [
            'namespace First { public class Box { public int Run(int x) { return x + 1; } } }',
            'namespace Second { public class Box { } }'
        ].join('\n')
    };
    const after = {
        'after.cs': [
            'namespace First { public class Box { } }',
            'namespace Second { public class Box { public int Run(int x) { return x + 1; } } }'
        ].join('\n')
    };
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.status, 'complete');
    assert(!relationPairs(result.analysis).some(([source, destination]) =>
        source === 'First.Box.Run' && destination === 'Second.Box.Run'));
    assert(!relationPairs(result.analysis).some(([source, destination]) =>
        source.split('.')[0] !== destination.split('.')[0]));
});

test('C# unsupported members, local bindings, and anonymous syntax are explicit exclusions', () => {
    const text = [
        'namespace Exclusions {',
        '    public class Demo {',
        '        public int A, B;',
        '        public int Good;',
        '        public event Action Event;',
        '        public event Action Changed { add { } remove { } }',
        '        public int this[int i] { get => i; }',
        '        public static Demo operator +(Demo left, Demo right) => left;',
        '        public static explicit operator int(Demo value) => 1;',
        '        ~Demo() { }',
        '        public void Run() {',
        '            int local = 1;',
        '            using (var resource = GetResource()) { Consume(resource); }',
        '            void Hidden() { }',
        '            Consume(() => 1);',
        '            Consume(delegate { });',
        '            Consume(new { Value = local });',
        '        }',
        '    }',
        '}'
    ].join('\n');
    const inventory = inventorySnapshot({ 'a.cs': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(entry => entry.qualifiedName), [
        'Exclusions', 'Exclusions.Demo', 'Exclusions.Demo.Good', 'Exclusions.Demo.Run'
    ]);
    const reasons = new Set(inventory.exclusions.map(exclusion => exclusion.reason));
    for (const reason of [
        'csharp-multiple-field-declarators',
        'csharp-unsupported-event-field',
        'csharp-unsupported-event',
        'csharp-unsupported-indexer',
        'csharp-unsupported-operator',
        'csharp-unsupported-conversion-operator',
        'csharp-unsupported-destructor',
        'csharp-local-binding',
        'csharp-local-using',
        'csharp-local-function',
        'csharp-anonymous-lambda',
        'csharp-anonymous-method',
        'csharp-anonymous-class'
    ]) assert(reasons.has(reason), reason);
    assert(!inventory.entries.some(entry => ['A', 'B', 'Event', 'Changed', 'Hidden'].includes(entry.name)));
});

test('C# malformed syntax fails closed and does not produce relations', () => {
    const result = analyzeStrand(
        { 'before.cs': 'namespace Stable { public class Box { public int Run() => 1; } }' },
        { 'after.cs': 'namespace Broken { public class Box { public int Run( ' }
    );
    assert.equal(result.analysis.relations.length, 0);
    assert.equal(result.native.reason, 'parse-preflight-failed');
    assert.equal(result.analysis.inventories.after.documents[0].status, 'invalid');
});

test('C# duplicate copies remain ambiguous', () => {
    const copy = 'namespace Shared { public class Box { public int Run(int x) { return x * 3 + 1; } } }';
    const result = analyzeStrand(
        { 'a.cs': copy, 'b.cs': copy },
        { 'c.cs': copy, 'd.cs': copy }
    );
    assert.equal(result.analysis.relations.length, 0);
    assert(result.native.unresolved.some(group => group.reason === 'ambiguous-csharp-candidates'));
});
