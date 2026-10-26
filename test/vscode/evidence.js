const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const workspace = require('../../out/reviewWorkspace');
const { digest } = require('../../out/requirements');
const { analyzeLiveSymbols } = require('../../out/liveSymbols');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await check()) return; await delay(40); }
    throw new Error('Timed out: ' + label);
}
exports.run = async () => {
    const root = process.env.BYGONE_FOLLOW_FIXTURE;
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const file = path.join(root, 'A.ts'), uri = vscode.Uri.file(file), base = git('rev-parse', 'HEAD');
    const source = 'export function selected(x: number) {\n    return x + 2;\n}\n\nexport function other() { return 9; }\n';
    fs.writeFileSync(file, source); git('add', '.'); git('commit', '-m', 'evidence fixture');
    const head = git('rev-parse', 'HEAD');
    const symbols = await analyzeLiveSymbols(file, file, source, source);
    const symbol = symbols.right.find(s => s.name === 'selected'); assert.ok(symbol);
    const ref = { revision: head, path: 'A.ts', start: symbol.start, end: symbol.end, digest: digest(source.slice(symbol.start, symbol.end)) };
    const review = { version: 2, repository: 'synthetic', base, head, requirements: [{ id: 'R1', text: 'Add two', sources: [{ title: 'Fixture', text: 'Add two', quote: 'Add two' }] }],
        questions: [], links: [{ id: 'L1', requirement: 'R1', role: 'implementation', rationale: 'Inspect selected', ref }], runs: [], analyses: [], decisions: [] };
    const artifact = path.join(root, 'review.json'); workspace.writeReview(artifact, review);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const api = await vscode.extensions.getExtension('davidmashburn.bygone').activate();
    await vscode.commands.executeCommand('bygone.followActiveEditor');
    const msg = () => api.provider.panels.get('follow')?.currentMessage;
    await until(() => msg()?.editBinding, 'initial following');
    const panel = api.provider.panels.get('follow').panel;
    async function rendererContent() {
        let value; const requestId = Date.now();
        const listener = panel.webview.onDidReceiveMessage(m => { if (m.type === 'navigationState' && m.requestId === requestId) value = m.buffers; });
        try {
            await until(() => api.renders > 0, 'Monaco ready');
            await panel.webview.postMessage({ type: 'captureNavigationState', requestId, flushEditors: true });
            await until(() => value, 'renderer buffers');
            return value.find(b => b.id === 'right').content;
        } finally { listener.dispose(); }
    }
    await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(artifact), vscode.Uri.file(root));
    const evidence = api.evidence;
    assert.equal(evidence.review.head, head);
    await evidence.action({ action: 'diff', index: 0 });
    assert.deepEqual(api.provider.currentMessage.editableSides, { left: false, right: false });
    assert.equal(api.provider.currentMessage.rightContent, source);
    console.log('EVIDENCE PASS pinned source comparison is read-only');
    await evidence.action({ action: 'edit-file', index: 0 });
    await until(() => msg()?.editBinding && msg().rightContent === source, 'working file');
    assert.match(msg().follow.status, /Review snapshot/);
    await until(async () => await rendererContent() === source, 'full-file renderer');
    await panel.webview.postMessage({ type: 'testEdit', start: source.indexOf('+ 2') + 2, end: source.indexOf('+ 2') + 3, text: '4' });
    await until(() => doc.getText().includes('+ 4'), 'live edit');
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    await panel.webview.postMessage({ type: 'testAction', action: 'undo' });
    await until(() => doc.getText() === source, 'shared undo');
    console.log('EVIDENCE PASS working file edit shares TextDocument dirty state and undo');
    // The same declaration moves because a different editor inserted a prefix.
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(b => b.insert(new vscode.Position(0, 0), '// unsaved prefix\n'));
    await evidence.action({ action: 'edit', index: 0 });
    await until(() => msg()?.editBinding && msg().rightContent === source.slice(ref.start, ref.end), 'mapped symbol slice');
    const slice = msg().rightContent;
    await until(async () => await rendererContent() === slice, 'slice renderer');
    await panel.webview.postMessage({ type: 'testEdit', start: slice.indexOf('+ 2') + 2, end: slice.indexOf('+ 2') + 3, text: '7' });
    await until(() => doc.getText().includes('+ 7'), 'slice write');
    assert.ok(doc.getText().startsWith('// unsaved prefix\n'));
    assert.ok(doc.getText().endsWith('export function other() { return 9; }\n'));
    assert.equal(git('show', ':A.ts'), source.trim());
    console.log('EVIDENCE PASS exact symbol mapping and granular slice edits preserve neighboring text and index');
    assert.equal(msg().follow.canReturnToReview, true);
    await panel.webview.postMessage({ type: 'testAction', action: 'returnReview' });
    await until(() => evidence.panel.visible, 'return to review');
    assert.equal(evidence.review.head, head);
    assert.equal(evidence.review.links[0].ref.digest, ref.digest);
    evidence.panel.dispose();
    await vscode.commands.executeCommand('bygone.returnToEvidenceReview');
    assert.ok(evidence.panel.visible);
    assert.equal(evidence.review.links[0].ref.digest, ref.digest);
    await doc.save(); git('add', 'A.ts'); git('commit', '-m', 'repair');
    assert.equal(evidence.review.head, head);
    const refreshed = workspace.refreshWorkspace(root, review, 'HEAD');
    assert.equal(refreshed.transitions[0].status, 'unresolved');
    const next = path.join(root, 'refreshed.json'); workspace.writeReview(next, refreshed.review);
    await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(next), vscode.Uri.file(root));
    assert.notEqual(evidence.review.head, head);
    assert.equal(JSON.parse(fs.readFileSync(artifact)).head, head);
    await vscode.commands.executeCommand('bygone.returnToEvidenceReview');
    assert.equal(evidence.review.head, head, 'Return restores the originating review even after opening a different review');
    console.log('EVIDENCE PASS return retains origin and explicit refresh preserves historical artifact');
    // Hold an actual symbol worker's result while the review changes/closes.
    // Neither the follower baseline nor its return origin may be replaced afterward.
    const { Worker } = require('node:worker_threads');
    for (const transition of ['replace', 'close']) {
        await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(artifact), vscode.Uri.file(root));
        const baselineBefore = api.controller.baseline, originBefore = evidence.origin;
        const emit = Worker.prototype.emit;
        let release, pending;
        Worker.prototype.emit = function(event, ...args) {
            if (event === 'message' && !release && args[0]?.leftDigest === digest(source)
                && args[0]?.rightDigest === digest(doc.getText())) {
                release = () => emit.call(this, event, ...args);
                return true;
            }
            return emit.call(this, event, ...args);
        };
        try {
            pending = evidence.action({ action: 'edit', index: 0 });
            await until(() => release, 'pending symbol handoff');
            if (transition === 'replace') {
                await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(next), vscode.Uri.file(root));
            } else evidence.panel.dispose();
            release();
            await pending;
            assert.equal(api.controller.baseline, baselineBefore, 'stale mapping cannot change the live comparison');
            assert.equal(evidence.origin, originBefore, 'stale mapping cannot replace the return context');
            if (transition === 'replace') assert.equal(evidence.review.head, refreshed.review.head);
            else assert.equal(evidence.panel, undefined);
        } finally {
            Worker.prototype.emit = emit;
            release?.();
            await pending;
        }
    }
    await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(artifact), vscode.Uri.file(root));
    console.log('EVIDENCE PASS changing or closing a review discards an in-flight symbol handoff');
    // Unsupported arbitrary subranges cannot be relocated by name or offset.
    const partial = { ...ref, start: ref.start + 1, digest: digest(source.slice(ref.start + 1, ref.end)) };
    await api.controller.openReviewEvidence(root, partial, source);
    await until(() => msg()?.rightContent === doc.getText(), 'unmapped file fallback');
    assert.match(msg().follow.status, /No exact symbol mapping/);
    console.log('EVIDENCE PASS ambiguous/partial evidence falls back to full-file context');
    await vscode.commands.executeCommand('bygone.openEvidenceReview', vscode.Uri.file(artifact), vscode.Uri.file(root));
    git('mv', 'A.ts', 'Moved.ts');
    await evidence.action({ action: 'edit', index: 0 });
    await until(() => msg()?.sourceInfo?.rightPath === path.join(root, 'Moved.ts'), 'renamed working target');
    assert.equal(msg().leftContent, source.slice(ref.start, ref.end));
    console.log('EVIDENCE PASS Git rename retains the historical source and maps the working counterpart');
    fs.unlinkSync(path.join(root, 'Moved.ts'));
    await evidence.action({ action: 'edit-file', index: 0 });
    assert.equal(vscode.window.activeTextEditor.document.uri.scheme, 'bygone-evidence');
    assert.equal(vscode.window.activeTextEditor.document.getText(), source);
    console.log('EVIDENCE PASS absent counterpart opens read-only evidence without inventing editable content');
    const markdown = '# Pinned heading\n\nBody\n';
    fs.writeFileSync(path.join(root, 'notes.md'), markdown); git('add', '.'); git('commit', '-m', 'markdown');
    const mdRef = { revision: git('rev-parse', 'HEAD'), path: 'notes.md', start: 0, end: markdown.length, digest: digest(markdown) };
    fs.writeFileSync(path.join(root, 'notes.md'), markdown + 'Changed\n');
    await api.controller.openReviewEvidence(root, mdRef, markdown);
    await until(() => msg()?.rightContent === markdown + 'Changed\n', 'unsupported full-file fallback');
    assert.equal(msg().editableSides.right, true);
    assert.match(msg().follow.status, /No exact symbol mapping/);
    console.log('EVIDENCE PASS unsupported symbol syntax keeps editable full-file context');
};
