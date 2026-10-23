const fs = require('node:fs');
const path = require('node:path');
const { inventorySnapshot } = require('../symbol-inventory');
const root = path.join(__dirname, '..');
const result = {};
for (const [input, report] of [
    ['manifest.json', 'refactoring-mappings-corpus-2026-10-22.json'],
    ['diagnostics.json', 'refactoring-mappings-diagnostics-2026-10-22.json']
]) {
    const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'semantic-corpus', input))).cases;
    const outputs = JSON.parse(fs.readFileSync(path.join(root, 'results', report))).cases;
    for (const fixture of fixtures) {
        let before = fixture.before, after = fixture.after;
        if (fixture.excludeUnchanged) {
            const keep = p => before[p] !== after[p];
            const a = Object.fromEntries(Object.entries(before).filter(([p]) => keep(p)));
            const b = Object.fromEntries(Object.entries(after).filter(([p]) => keep(p)));
            before = a; after = b;
        }
        const analysis = outputs.find(c => c.id === fixture.id).analysis;
        const snapshots = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
        const ids = new Map();
        const inventory = {};
        for (const side of ['before', 'after']) {
            inventory[side] = snapshots[side].entries.map((e, i) => {
                const id = `${side === 'before' ? 'b' : 'a'}${i}`; ids.set(e.id, id);
                return { id, path: e.path, name: e.qualifiedName, kind: e.kind, start: e.start, end: e.end };
            });
        }
        result[fixture.id] = { inventory,
            correspondences: analysis.relations.map(r => ({ source: ids.get(r.sourceId), destination: ids.get(r.destinationId), rawEqual: r.rawEqual })),
            groups: analysis.groups.map(g => ({ kind: g.kind, source: ids.get(g.sourceId), destination: ids.get(g.destinationId), status: g.status })),
            unresolved: analysis.unresolved.map(u => ({ reason: u.reason, sources: u.sources.map(id => ids.get(id)), destinations: u.destinations.map(id => ids.get(id)) })),
            parseDiagnostics: Object.fromEntries(Object.entries(snapshots).map(([side, inv]) => [side, inv.documents.filter(d => d.status !== 'complete')])),
            exclusions: Object.fromEntries(Object.entries(snapshots).map(([side, inv]) => [side, inv.exclusions])),
            scope: { before: Object.keys(before), after: Object.keys(after), note: 'Only these supplied files were searched. Callback expressions and registration statements are not inventoried as symbols.' }
        };
    }
}
fs.writeFileSync(path.join(__dirname, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log('Evidence generated without labels or adjudication data');
