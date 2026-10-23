const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');

test('inventories literal registerType registrations and direct methods with UTF-16 ranges', () => {
    const text = '/* 🧭 */\r\nregisterType("Query", {\r\n    resolve() { return "💡"; },\r\n    field: () => "callback",\r\n});\r\n';
    const inventory = inventorySnapshot({ 'src/cart.js': text }, 'before');
    const registration = inventory.entries.find(entry => entry.kind === 'registration');
    const method = inventory.entries.find(entry => entry.qualifiedName === 'Query.resolve');

    assert(registration);
    assert.equal(registration.name, 'Query');
    assert.equal(registration.qualifiedName, 'Query');
    assert.equal(registration.callable, true);
    assert.equal(text.slice(registration.start, registration.end), 'registerType("Query", {\r\n    resolve() { return "💡"; },\r\n    field: () => "callback",\r\n});');
    assert.deepEqual(registration.engineRanges, [{ start: registration.start, end: registration.end }]);

    assert(method);
    assert.equal(method.name, 'resolve');
    assert.equal(method.kind, 'method');
    assert.equal(method.parent, 'Query');
    assert.equal(text.slice(method.start, method.end), 'resolve() { return "💡"; }');
    assert.deepEqual(method.engineRanges, [{ start: method.start, end: method.end }]);
    assert.equal(inventory.entries.some(entry => entry.qualifiedName === 'Query.field'), false);
    assert.equal(inventory.documents[0].utf16Length, text.length);
});

test('duplicate registrations remain ambiguous for exact correspondence', () => {
    const text = 'registerType("Query", { resolve() { return 1; } });\n'
        + 'registerType("Query", { resolve() { return 1; } });\n';
    const result = normalizeMappings({ 'a.js': text }, { 'a.js': text }, { status: 'complete', truncated: false, mappers: [] });
    const registrations = result.inventories.before.entries.filter(entry => entry.kind === 'registration');

    assert.equal(registrations.length, 2);
    assert.equal(new Set(registrations.map(entry => entry.qualifiedName)).size, 1);
    assert.equal(result.relations.length, 0);
    assert(result.unresolved.some(group => group.reason === 'repeated-exact-occurrences'
        && registrations.every(entry => group.sources.includes(entry.id))));
    assert(result.unmatchedDiagnostics.some(diagnostic => diagnostic.symbolId === registrations[0].id
        && diagnostic.reason === 'ambiguous-symbol'));
});

test('exact registrations can move while namespace exclusions keep their reason', () => {
    const text = 'registerType("Query", { resolve() { return 1; } });';
    const result = normalizeMappings({ 'a.js': text }, { 'b.js': text }, { status: 'unavailable', mappers: [] });
    assert.equal(result.relations.length, 2);
    assert(result.relations.every(relation => relation.pathChanged && relation.rawEqual));
    const inventory = inventorySnapshot({ 'a.ts': 'namespace N { export function run() {} }' }, 'before');
    assert.equal(inventory.exclusions[0].reason, 'namespace-members-not-enumerated');
});

test('only the explicit literal registration shape is inventoried', () => {
    const text = [
        'registerType(typeName, { resolve() {} });',
        'registerType("dynamic-" + suffix, { resolve() {} });',
        'registerType(`Template`, { resolve() {} });',
        'registerType("WrongShape", callback);',
        'registerSchema("Schema", { resolve() {} });',
        'other("Other", { resolve() {} });',
        'registerType("TooMany", { resolve() {} }, options);',
        'registerType("Query", { resolve() {}, field: () => 1, [dynamicMethod]() {} });',
        'function wrapper() { registerType("Nested", { resolve() {} }); }'
    ].join('\n');
    const inventory = inventorySnapshot({ 'a.js': text }, 'before');
    const registrationEntries = inventory.entries.filter(entry => entry.kind === 'registration' || entry.parent === 'Query');

    assert.deepEqual(registrationEntries.map(entry => entry.qualifiedName), ['Query', 'Query.resolve']);
    assert.equal(inventory.entries.some(entry => entry.qualifiedName === 'Nested'), false);
    assert.equal(inventory.entries.some(entry => entry.qualifiedName === 'Query.field'), false);
    assert(inventory.exclusions.filter(exclusion => exclusion.reason === 'unmodeled-top-level-statement').length >= 7);
});

test('invalid registration syntax preserves invalid-document handling', () => {
    const inventory = inventorySnapshot({ 'a.js': 'registerType("Query", { resolve() { return 1; };\n' }, 'before');

    assert.equal(inventory.documents[0].status, 'invalid');
    assert.equal(inventory.entries.length, 0);
    assert(inventory.documents[0].diagnostics.length > 0);
});
