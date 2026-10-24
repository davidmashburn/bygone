const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = require('./fixtures/correspondence-module-split.json');
function correspondenceFixture(input = source) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-symbol-test-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init'); git('config', 'user.name', 'Bygone test'); git('config', 'user.email', 'test@example.test');
    const write = files => { for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); } };
    write(input.before); git('add', '.'); git('commit', '-m', 'Before'); const baseOid = git('rev-parse', 'HEAD');
    for (const name of Object.keys(input.before)) fs.unlinkSync(path.join(root, name));
    write(input.after); git('add', '.'); git('commit', '-m', 'After'); const headOid = git('rev-parse', 'HEAD');
    return { root, range: { baseOid, headOid }, dispose() { fs.rmSync(root, { recursive: true, force: true }); } };
}
module.exports = { correspondenceFixture, source };
