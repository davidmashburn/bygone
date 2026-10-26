import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-follow-host-'));
const fixture = path.join(root, 'fixture');
const extension = path.join(root, 'extension');
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
try {
    fs.mkdirSync(fixture); fs.mkdirSync(extension);
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    for (const name of ['A', 'B', 'C']) fs.writeFileSync(path.join(fixture, `${name}.ts`), `export function ${name.toLowerCase()}() { return 1; }\n`);
    git('add', '.'); git('commit', '-m', 'fixture');
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
    manifest.main = './entry.js';
    fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify(manifest));
    fs.mkdirSync(path.join(extension, 'media'));
    for (const file of ['webview.js', 'webview.css', 'editor.worker.js', 'diff.worker.js']) fs.copyFileSync(path.join(repo, 'media', file), path.join(extension, 'media', file));
    if (process.env.BYGONE_SCM_TEST || process.env.BYGONE_EVIDENCE_TEST) await build({
        entryPoints: [path.join(repo, 'media/webview-entry.js')], outfile: path.join(extension, 'media/webview.js'),
        bundle: true, minify: true, loader: { '.md': 'text', '.ttf': 'dataurl' }, plugins: [{ name: 'renderer-test-driver', setup(build) {
            build.onLoad({ filter: /media\/script\.js$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8') + `
window.addEventListener('bygone:host-message', event => {
    const m = event.detail;
    if (m.type === 'captureNavigationState') host.postMessage({ type:'testSyncState', state:followSync.state() });
    if (m.type === 'testEdit' || m.type === 'testEditActions') {
        const model = rightEditor.getModel();
        const start = model.getPositionAt(m.start), end = model.getPositionAt(m.end);
        rightEditor.executeEdits('fixture', [{ range: new monacoInstance.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: m.text }]);
        for (const action of m.actions ?? []) followSync.action(action);
    }
    if (m.type === 'testComposition') window.dispatchEvent(new CompositionEvent('composition'+m.phase));
    if (m.type === 'testAction') followSync.action(m.action);
});`, loader: 'js' }));
        } }] });
    await build({ entryPoints: [path.join(repo, 'test/vscode/entry.js')], outfile: path.join(extension, 'entry.js'), bundle: true, platform: 'node', external: ['vscode'] });
    fs.copyFileSync(path.join(repo, 'out/liveSymbolsWorker.js'), path.join(extension, 'liveSymbolsWorker.js'));
    const userData = path.join(root, 'user-data');
    fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'workbench.tips.enabled': false, 'chat.disableAIFeatures': true, 'telemetry.telemetryLevel': 'off' }));
    const executable = process.env.BYGONE_VSCODE_EXECUTABLE || await downloadAndUnzipVSCode(process.env.BYGONE_VSCODE_VERSION || 'stable');
    await runTests({
        vscodeExecutablePath: executable, extensionDevelopmentPath: extension,
        extensionTestsPath: path.join(repo, process.env.BYGONE_EVIDENCE_TEST ? 'test/vscode/evidence.js' : process.env.BYGONE_SCM_TEST ? 'test/vscode/scm.js' : 'test/vscode/following.js'),
        extensionTestsEnv: { BYGONE_FOLLOW_FIXTURE: fixture, ELECTRON_RUN_AS_NODE: undefined },
        launchArgs: [fixture, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--user-data-dir='+userData, '--extensions-dir='+path.join(root, 'extensions')]
    });
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
