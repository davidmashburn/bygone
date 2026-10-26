const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveFollowBaseline, resolveFollowLocation, checkFollowText, FOLLOW_MAX_BYTES, FOLLOW_MAX_LINES } = require('../out/followBaseline');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-follow-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    const write = (name, content) => { const file = path.join(root, name); fs.writeFileSync(file, content); return file; };
    return { root, git, write };
}

test('unborn HEAD is an explicitly absent baseline', async t => {
    const f = fixture(t); const file = f.write('new.ts', 'new');
    const value = await resolveFollowBaseline(file);
    assert.equal(value.oid, null); assert.equal(value.absent, true); assert.equal(value.content, '');
});
test('baseline is HEAD, independent of staged and disk contents', async t => {
    const f = fixture(t); const file = f.write('a.ts', 'head\n');
    f.git('add', '.'); f.git('commit', '-m', 'fixture');
    f.write('a.ts', 'index\n'); f.git('add', '.'); f.write('a.ts', 'disk\n');
    const value = await resolveFollowBaseline(file);
    assert.equal(value.content, 'head\n'); assert.equal(value.oid, f.git('rev-parse', 'HEAD')); assert.equal(value.absent, false);
});
test('literal pathspecs handle spaces, colons, brackets and leading dash', async t => {
    const f = fixture(t); const files = ['space name.ts', 'a:b.ts', '[a].ts', '-x.ts'].map(n => f.write(n, n));
    f.git('add', '.'); f.git('commit', '-m', 'fixture');
    for (const file of files) assert.equal((await resolveFollowBaseline(file)).content, path.basename(file));
    const newFile = f.write('not-in-head.ts', 'new');
    assert.equal((await resolveFollowBaseline(newFile)).absent, true);
});
test('broken HEAD and non-repositories fail instead of inventing additions', async t => {
    const f = fixture(t); const file = f.write('a', 'a');
    f.git('add', '.'); f.git('commit', '-m', 'fixture');
    fs.writeFileSync(path.join(f.root, '.git', 'refs', 'heads', f.git('branch', '--show-current')), 'f'.repeat(40)+'\n');
    await assert.rejects(resolveFollowBaseline(file));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.writeFileSync(path.join(outside, 'a'), 'a');
    await assert.rejects(resolveFollowBaseline(path.join(outside, 'a')));
});
test('linked worktrees use their own root and HEAD', async t => {
    const f = fixture(t); f.write('a', 'original'); f.git('add', '.'); f.git('commit', '-m', 'fixture');
    const linked = path.join(f.root, 'linked'); f.git('worktree', 'add', '-b', 'linked', linked);
    fs.writeFileSync(path.join(linked, 'a'), 'linked');
    execFileSync('git', ['-C', linked, 'commit', '-am', 'linked'], { stdio: 'ignore' });
    const value = await resolveFollowBaseline(path.join(linked, 'a'));
    assert.equal(value.root, fs.realpathSync(linked)); assert.equal(value.content, 'linked');
});
test('directory aliases resolve to the tracked file in the physical worktree', async t => {
    const f = fixture(t); f.write('a.ts', 'tracked\n'); f.git('add', '.'); f.git('commit', '-m', 'fixture');
    const alias = f.root + '-alias';
    t.after(() => fs.rmSync(alias, { force: true, recursive: true }));
    fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const value = await resolveFollowBaseline(path.join(alias, 'a.ts'));
    assert.equal(value.root, fs.realpathSync(f.root));
    assert.equal(value.relativePath, 'a.ts');
    assert.equal(value.content, 'tracked\n');
    assert.equal(value.absent, false);
    assert.equal((await resolveFollowLocation(path.join(alias, 'missing', 'removed.ts'))).physicalPath, path.join(value.root, 'missing', 'removed.ts'));
    fs.symlinkSync('a.ts', path.join(f.root, 'link.ts'));
    assert.equal((await resolveFollowLocation(path.join(alias, 'link.ts'))).physicalPath, path.join(value.root, 'link.ts'));
});
test('binary, invalid UTF-8, oversized and excessive-line inputs are bounded', async t => {
    const f = fixture(t);
    const files = [f.write('binary', Buffer.from([0, 1])), f.write('encoding', Buffer.from([0xff])), f.write('large', 'a'.repeat(FOLLOW_MAX_BYTES+1))];
    f.git('add', '.'); f.git('commit', '-m', 'fixture');
    for (const file of files) await assert.rejects(resolveFollowBaseline(file));
    assert.throws(() => checkFollowText('\n'.repeat(5001)));
    assert.throws(() => checkFollowText('a\0'));
});
test('cancelled reads reject', async t => {
    const f = fixture(t); const file = f.write('a', 'a');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(resolveFollowBaseline(file, abort.signal), { name: 'AbortError' });
});
test('line limits accept the boundary with or without a final newline', () => {
    for (const newline of ['\n', '\r\n']) {
        const atLimit = Array(FOLLOW_MAX_LINES).fill('x').join(newline);
        assert.doesNotThrow(() => checkFollowText(atLimit));
        assert.doesNotThrow(() => checkFollowText(atLimit + newline));
        assert.throws(() => checkFollowText(atLimit + newline + 'x'));
        assert.throws(() => checkFollowText(atLimit + newline + 'x' + newline));
    }
});

const { resolveIndexSnapshot } = require('../out/followSnapshots');
test('index snapshots are immutable, literal and independent of working text', async t => {
    const f=fixture(t), file=f.write('[a]: b.ts','staged\n'); f.git('add','.');
    f.write('[a]: b.ts','working\n');
    assert.equal((await resolveIndexSnapshot(file)).content,'staged\n');
    f.git('rm','-f','--cached','--','[a]: b.ts');
    assert.equal((await resolveIndexSnapshot(file)).absent,true);
});
test('deleted directories retain index and HEAD path identity', async t => {
    const f=fixture(t); fs.mkdirSync(path.join(f.root,'nested')); const file=f.write('nested/a.ts','tracked\n');
    f.git('add','.'); f.git('commit','-m','fixture'); fs.rmSync(path.join(f.root,'nested'),{recursive:true});
    assert.equal((await resolveIndexSnapshot(file)).content,'tracked\n');
    assert.equal((await resolveFollowBaseline(file)).relativePath,'nested/a.ts');
});
test('linked worktree indexes and separate repositories remain isolated', async t => {
    const f=fixture(t); f.write('a.ts','base'); f.git('add','.'); f.git('commit','-m','fixture');
    const linked=path.join(f.root,'linked'); f.git('worktree','add','-b','linked',linked);
    fs.writeFileSync(path.join(linked,'a.ts'),'linked staged'); execFileSync('git',['-C',linked,'add','a.ts']);
    const other=fixture(t); other.write('a.ts','other staged'); other.git('add','.');
    assert.equal((await resolveIndexSnapshot(path.join(linked,'a.ts'))).content,'linked staged');
    assert.equal((await resolveIndexSnapshot(path.join(f.root,'a.ts'))).content,'base');
    assert.equal((await resolveIndexSnapshot(path.join(other.root,'a.ts'))).content,'other staged');
});
test('index conflicts, symlinks, binary, invalid UTF8 and oversized snapshots fail explicitly', async t => {
    const f=fixture(t); const file=f.write('a.ts','base'); f.git('add','.'); f.git('commit','-m','fixture');
    const branch=f.git('branch','--show-current'); f.git('checkout','-b','other'); f.write('a.ts','other'); f.git('commit','-am','other');
    f.git('checkout',branch); f.write('a.ts','main'); f.git('commit','-am','main');
    assert.throws(()=>f.git('merge','other'));
    await assert.rejects(resolveIndexSnapshot(file),/Merge conflicts/); f.git('merge','--abort');
    const files=[f.write('binary',Buffer.from([0,1])),f.write('encoding',Buffer.from([0xff])),f.write('large','x'.repeat(FOLLOW_MAX_BYTES+1))];
    fs.symlinkSync('a.ts',path.join(f.root,'link')); files.push(path.join(f.root,'link')); f.git('add','.');
    for (const value of files) await assert.rejects(resolveIndexSnapshot(value));
    const abort=new AbortController(); abort.abort(); await assert.rejects(resolveIndexSnapshot(file,abort.signal));
});
