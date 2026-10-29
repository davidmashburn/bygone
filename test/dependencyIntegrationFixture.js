const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { correspondenceFixture } = require('./correspondenceFixture');
const { buildNativeDependencyView } = require('../cli/dependency-native');
const digest = text => createHash('sha256').update(text).digest('hex');
async function dependencyIntegrationFixture() {
    const before = 'export function alpha() {}\nexport function beta() {}\nexport function run() { alpha(); }\nrun();\n';
    const after = before.replace('run() { alpha();', 'run() { beta();');
    const f = correspondenceFixture({ before: { 'app.ts': before }, after: { 'app.ts': after } });
    try {
        const { report } = await buildNativeDependencyView(f.root, f.range);
        const symbol = (n, side) => ({ id: side + n.id, path: n.source.file, name: n.name, kind: n.kind,
            start: n.source.start, end: n.source.end, digest: n.source.digest });
        const a = report.base.nodes.filter(n => n.kind === 'function').map(n => symbol(n, 'before'));
        const b = report.head.nodes.filter(n => n.kind === 'function').map(n => symbol(n, 'after'));
        const correspondence = { version: 1, range: f.range, producer: 'fixture', status: 'complete',
            documents: { before: [{ path: 'app.ts', digest: digest(before), status: 'complete' }], after: [{ path: 'app.ts', digest: digest(after), status: 'complete' }] },
            symbols: { before: a, after: b }, relations: a.map((n, i) => ({ id: String(i), sourceId: n.id,
                destinationId: b.find(m => m.name === n.name).id, producers: ['fixture'] })), unresolved: [], limitations: ['Synthetic correspondence fixture.'] };
        const file = path.join(f.root, 'correspondence.json'); fs.writeFileSync(file, JSON.stringify(correspondence));
        const view = await buildNativeDependencyView(f.root, { ...f.range, correspondence, focus: { file: 'app.ts', line: 3 } });
        return { ...f, ...view, correspondence, correspondenceFile: file };
    } catch (error) { f.dispose(); throw error; }
}
module.exports = { dependencyIntegrationFixture };
