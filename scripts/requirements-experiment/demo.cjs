const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { render } = require('./render.cjs');
const { pinSourceRef } = require('bygone-strand/source-references');

function demo(root, output, core) {
    const { analyzeGit } = require(path.join(root, 'scripts/change-analysis/analyze-git'));
    const { buildChangeTourManifest } = require(path.join(root, 'out/changeTour'));
    const repo = path.join(output, 'fixture');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }).trim();
    git('init', '-q'); git('config', 'user.name', 'Requirements Experiment'); git('config', 'user.email', 'experiment@example.invalid');
    git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');
    fs.appendFileSync(path.join(repo, '.git/info/exclude'), '\n.evidence/\n');
    const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);
    const commit = message => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    const source = operator => `function isExpired(token, now) {\n  return token.expiresAt ${operator} now;\n}\nmodule.exports = { isExpired };\n`;
    write('auth.js', source('<'));
    const baseOid = commit('test: create synthetic baseline');
    write('auth.js', source('<='));
    write('expiry.test.js', `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { isExpired } = require('./auth');\nfunction testExpiry() {\n  assert.equal(isExpired({ expiresAt: 100 }, 100), true);\n}\ntest('reject a token at its expiry boundary', testExpiry);\n`);
    write('theme.css', 'button { border-radius: 4px; }\n');
    const firstOid = commit('fix: reject expiry boundary in synthetic fixture');
    const snapshot = revision => ({ repository: 'synthetic-expiry-demo', revision, files: Object.fromEntries(
        git('ls-tree', '-r', '--name-only', revision).split('\n').filter(Boolean).map(name => [name, execFileSync('git', ['show', `${revision}:${name}`], { cwd: repo, encoding: 'utf8' })])) });
    const base = snapshot(baseOid), first = snapshot(firstOid);
    fs.mkdirSync(path.join(repo, '.evidence'));
    const artifact = (before, after, name) => {
        const file = path.join(repo, '.evidence', `${name}.json`);
        analyzeGit([after.revision, '--base', before.revision, '--repo', repo, '--engine', 'bygone-strand', '--output', file], root, { write() {} });
        return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    };
    const initial = artifact(base, first, 'initial');
    const symbolRef = (a, name, snap) => {
        const matches = a.data.symbols.after.filter(s => s.name === name);
        assert.equal(matches.length, 1, `Expected one ${name} declaration`);
        const symbol = matches[0];
        return pinSourceRef(snap, symbol.path, symbol.start, symbol.end);
    };
    const spec = 'Reject a token when now reaches its expiry time.\nRecord an audit event for every rejection.';
    const req = (id, text) => ({ id, text, sources: [{ title: 'Synthetic acceptance criteria', text: spec, quote: text }] });
    const evidence = a => core.correspondenceEvidence(a.data, ['Changed supported files supplied by analyzeGit']);
    let review = core.parseReview({ version: 2, repository: first.repository, base: base.revision, head: first.revision,
        requirements: [req('R1', 'Reject a token when now reaches its expiry time.'), req('R2', 'Record an audit event for every rejection.')],
        links: [
            { id: 'expiry', requirement: 'R1', role: 'implementation', rationale: 'The author links the expiry predicate to the boundary requirement.', ref: symbolRef(initial, 'isExpired', first) },
            { id: 'test', requirement: 'R1', role: 'test', rationale: 'This test calls the public auth export at the exact expiry boundary.', ref: symbolRef(initial, 'testExpiry', first) }
        ], runs: [], decisions: [], questions: [{ id: 'Q1', requirement: 'R2', text: 'Does every rejection include malformed tokens?', status: 'open', alternatives: [
            { text: 'Every rejection includes malformed tokens', sources: req('R2', 'Record an audit event for every rejection.').sources },
            { text: 'Only expiry rejections need an audit event', sources: [{ title: 'Synthetic discussion', text: 'Audit expiry rejections.', quote: 'Audit expiry rejections.' }] }
        ] }], analyses: [evidence(initial).analysis] });
    const recordRun = (review, name) => {
        // Only this fixed synthetic test is executed. Imported commands are never executed.
        assert.equal(git('rev-parse', 'HEAD'), review.head);
        const result = spawnSync(process.execPath, ['--test', 'expiry.test.js'], { cwd: repo, encoding: 'utf8', timeout: 30_000 });
        if (result.error || result.status === null) throw result.error || new Error('Synthetic test did not complete');
        const text = result.stdout + result.stderr;
        fs.writeFileSync(path.join(output, `${name}.test.log`), text);
        review.runs.push({ revision: review.head, requirements: [{ requirement: 'R1', fingerprint: core.requirementFingerprint(review, 'R1'), scope: 'Exact expiry boundary through the public auth export; other token validation is untested.' }], command: 'node --test expiry.test.js', outcome: result.status === 0 ? 'passed' : 'failed', outputDigest: core.digest(text) });
        return result.status;
    };
    assert.equal(recordRun(review, 'initial'), 0);
    review.decisions.push({ requirement: 'R1', fingerprint: core.fingerprint(review, 'R1'), note: 'Synthetic reviewer note: inspected the boundary predicate and linked test.' });
    const phases = [];
    const save = (name, title, snap, current, correspondence, transitions = []) => {
        const report = core.inspect(current, base, snap);
        fs.writeFileSync(path.join(output, `${name}.review.json`), JSON.stringify(current, null, 2));
        fs.writeFileSync(path.join(output, `${name}.report.json`), JSON.stringify({ report, transitions }, null, 2));
        // Reuse Bygone's existing requirement annotations and exact symbol stops.
        const anchors = {}, steps = [];
        for (const requirement of report.requirements) for (const link of requirement.links) {
            if (link.resolution.status !== 'valid') continue;
            anchors[link.id] = { file: link.ref.path, revision: 'head', contains: link.resolution.text };
            const symbol = correspondence.data.symbols.after.find(s => s.path === link.ref.path && s.start === link.ref.start && s.end === link.ref.end);
            const relation = symbol && correspondence.data.relations.find(r => r.destinationId === symbol.id);
            steps.push({ id: link.id, title: `${requirement.id}: ${link.role}`, body: `${link.rationale} Reference validity does not establish fulfillment. ${report.requirements.find(r => r.id === requirement.id).verification}.`,
                focus: link.id, ...(relation ? { symbol: { relation: relation.id } } : {}),
                requirement: { id: requirement.id, text: requirement.text, source: requirement.sources.map(s => s.title).join('; ') } });
        }
        const tour = { version: 6, title: `Requirements experiment: ${title}`, range: { base: base.revision, head: snap.revision },
            correspondence: path.relative(repo, correspondence.file), anchors, connections: [],
            chapters: [{ id: 'requirements', title: 'Requirement evidence', scenes: [{ id: 'evidence', kind: 'walkthrough', title: 'Inspect the recorded evidence',
                summary: 'A synthetic requirement points to implementation and test declarations.', bullets: ['R2 has no linked implementation or verification.'],
                tags: [], takeaway: 'Evidence links, execution records, and reviewer decisions remain separate.', steps }] }] };
        const tourPath = path.join(repo, '.evidence', `${name}.bygone`);
        fs.writeFileSync(tourPath, JSON.stringify(tour, null, 2));
        const manifest = buildChangeTourManifest(repo, { source: tour });
        fs.writeFileSync(path.join(output, `${name}.manifest.json`), JSON.stringify(manifest));
        phases.push({ name, title, head: snap.revision, report, transitions, tourPath });
    };
    save('initial', 'Initial review', first, review, initial);
    write('expiry.js', source('<='));
    write('auth.js', "const { isExpired } = require('./expiry');\nmodule.exports = { isExpired };\n");
    const moved = snapshot(commit('refactor: move synthetic expiry predicate'));
    const moveDelta = artifact(first, moved, 'move-delta');
    const movedResult = core.refresh(review, first, moved, evidence(moveDelta));
    assert.equal(movedResult.transitions.find(t => t.link === 'expiry').status, 'relocated');
    assert.equal(core.inspect(movedResult.review, base, moved).requirements[0].verification, 'not-recorded');
    review = movedResult.review;
    save('moved', 'After a move', moved, review, artifact(base, moved, 'moved'), movedResult.transitions);
    write('expiry.js', source('<'));
    const changed = snapshot(commit('test: introduce deliberate expiry regression'));
    const changeDelta = artifact(moved, changed, 'change-delta');
    const changedResult = core.refresh(review, moved, changed, evidence(changeDelta));
    assert.equal(changedResult.transitions.find(t => t.link === 'expiry').status, 'changed');
    review = changedResult.review;
    assert.equal(recordRun(review, 'changed'), 1, 'The intentional boundary regression must fail');
    save('changed', 'After a regression', changed, review, artifact(base, changed, 'changed'), changedResult.transitions);
    assert.equal(phases[2].report.requirements[0].verification, 'recorded-failure');
    const html = render(phases, [first, moved, changed]);
    const htmlPath = path.join(output, 'experiment.html');
    fs.writeFileSync(htmlPath, html);
    return { output, html: htmlPath, tours: phases.map(p => p.tourPath), checks: 'Core tests passed; real Strand relocation/edit mappings and three compiled Bygone tours verified; deliberate regression test failed as expected.' };
}
module.exports = { demo };
