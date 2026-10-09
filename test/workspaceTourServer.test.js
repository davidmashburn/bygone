const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startPresentation } = require('../cli/present.js');
const { parseTourSourceText } = require('../cli/tourFile.js');

test('uploaded tours are validated in the existing repository and retain independent histories', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-upload-')));
    let presentation;
    try {
        const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
        git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
        const commits = [];
        for (let index = 0; index < 3; index++) {
            fs.writeFileSync(path.join(root, 'file.txt'), `value ${index}\n`);
            git('add', '.'); git('commit', '-m', `Change ${index}`); commits.push(git('rev-parse', 'HEAD'));
        }
        const source = (head) => ({ version: 4, range: { base: commits[0], head }, anchors: {
            line: { file: 'file.txt', revision: 'head', contains: 'value' }
        }, connections: [], chapters: [{ id: 'chapter', title: 'Change', scenes: [{
            id: 'scene', kind: 'walkthrough', title: 'Read the change', summary: 'The value changes.', bullets: [], tags: [], takeaway: 'Read the real value.',
            steps: [{ id: 'step', title: 'Value', body: 'The committed value.', focus: 'line' }]
        }] }] });
        fs.writeFileSync(path.join(root, 'tour.bygone'), JSON.stringify(source(commits[1])));
        presentation = await startPresentation(['--tour', 'tour.bygone'], root, path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        const origin = new URL(presentation.url).origin;
        const upload = (body, requestOrigin = origin) => fetch(`${origin}/tour/open`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(body)
        });
        assert.equal((await upload({ source: JSON.stringify(source(commits[2])) }, 'https://untrusted.example')).status, 403);
        assert.equal((await upload({ source: 'not a tour' })).status, 400);
        const legacy = JSON.stringify({ ...source(commits[2]), version: 3, review: { title: 'Original notes' } });
        const offer = await upload({ source: legacy });
        assert.equal(offer.status, 409);
        assert.equal((await offer.json()).conversion.fromVersion, 3);
        assert.equal((await upload({ source: legacy, convertToV4: 'true' })).status, 409);
        const converted = await upload({ source: legacy, convertToV4: true });
        assert.equal(converted.status, 200);
        const convertedResult = await converted.json();
        const convertedSource = parseTourSourceText(convertedResult.convertedSource);
        assert.equal(convertedSource.version, 4);
        assert.equal(convertedSource.review, undefined);
        assert.equal(convertedSource.chapters[0].scenes[0].id, 'scene');
        assert.match(convertedSource.chapters[0].scenes[0].steps[0].body, /Original notes/);
        assert.equal((await (await fetch(`${origin}${convertedResult.manifestUrl}`)).json()).version, 4);
        assert.equal((await upload({ source: JSON.stringify({ ...source(commits[2]), version: 6 }), convertToV4: true })).status, 400);
        const response = await upload({ source: JSON.stringify(source(commits[2])) });
        assert.equal(response.status, 200);
        const opened = await response.json();
        assert.equal(opened.range.headOid, commits[2]);
        const loaded = await (await fetch(`${origin}${opened.manifestUrl}`)).json();
        const original = await (await fetch(`${origin}/tour.json`)).json();
        assert.equal(loaded.range.headOid, commits[2]);
        assert.equal(original.range.headOid, commits[1]);
        const historyUrl = opened.manifestUrl.replace('tour.json', 'history/list');
        const history = await (await fetch(`${origin}${historyUrl}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ commit: commits[2] })
        })).json();
        assert.equal(history.entries[0].commit, commits[2]);
        assert.throws(() => parseTourSourceText('a'.repeat(1024 * 1024 + 1)), /size limit/);
        assert.throws(() => parseTourSourceText('a\0b'), /Invalid tour text/);
    } finally {
        if (presentation) await new Promise((resolve) => presentation.server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
