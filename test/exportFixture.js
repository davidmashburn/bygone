const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildChangeInventory } = require('../out/changeTour.js');

function exportFixture({ multipleFocuses = false } = {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-export-test-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
    const commit = message => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
    git('init'); git('config', 'user.name', 'Export test'); git('config', 'user.email', 'test@example.test');
    const appText = (value, tail) => `alpha\n${value}\n${multipleFocuses ? `${'unchanged\n'.repeat(30)}${tail}\n` : ''}`;
    write('old.txt', 'rename me\n'); write('app.txt', appText('beta', 'old tail'));
    const outside = commit('Outside the export');
    write('base.txt', 'base\n'); const base = commit('Base'); git('branch', 'export-base');
    write('app.txt', appText('intermediate', 'old tail')); write('transient.txt', 'only in history\n');
    const middle = commit('Intermediate');
    git('mv', 'old.txt', 'new.txt'); git('rm', 'transient.txt');
    write('app.txt', appText('BETA', 'new tail')); write('binary.dat', Buffer.from([0, 1, 2]));
    write('large.txt', 'x'.repeat(2 * 1024 * 1024 + 1));
    const head = commit('Head'); git('branch', 'export-head');
    const inventory = buildChangeInventory(root, { baseRef: base, headRef: head });
    const hunks = inventory.files.find(file => file.path === 'app.txt').units.map(unit => unit.id);
    const narrative = { summary: 'Read </script> safely.', bullets: [], tags: [], takeaway: 'Exact evidence' };
    const chapters = [{ id: 'chapter', title: 'Chapter', scenes: [{ id: 'scene', kind: 'walkthrough', title: 'Scene', ...narrative,
        steps: [{ id: 'step', title: 'Step', body: 'Evidence', focus: 'changed' }] }] }];
    const source = { version: 5, title: 'Export <fixture>', range: { base: 'export-base', head: 'export-head' },
        anchors: { changed: { file: 'app.txt', revision: 'head', contains: 'BETA' } }, connections: [], chapters,
        tours: { historical: { opening: { title: 'Review question', summary: 'Trace the evidence for the changed line.' }, conclusion: { title: 'What we established', summary: 'The changed line is captured in real revisions.' }, chapters }, deconstructed: { chapters: [{ id: 'explain', title: 'Explanation', scenes: [{
            id: 'synthetic', kind: 'deconstructed-diff', title: 'Stages', ...narrative,
            exclusions: inventory.files.filter(file => file.path !== 'app.txt').map(file => ({ file: file.path, reason: 'Outside this explanation' })),
            stages: [{ id: 'stage', title: 'Change', narration: 'Explain', changes: [{ file: 'app.txt', hunks }] }]
        }] }] } },
    };
    const sourcePath = path.join(root, 'test.bygone'); write('test.bygone', JSON.stringify(source));
    return { root, sourcePath, source, git, base, middle, head, outside, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
module.exports = { exportFixture };
