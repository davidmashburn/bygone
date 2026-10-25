const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
    const end = Date.now()+timeout;
    while (Date.now()<end) { if (await check()) return; await delay(40); }
    throw new Error('Timed out: '+label);
}
async function test(name, body) { await body(); console.log('SCM PASS '+name); }
exports.run = async () => {
    const root = process.env.BYGONE_FOLLOW_FIXTURE;
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
    const uri = vscode.Uri.file(path.join(root,'A.ts'));
    const original = 'export function original(a:number) {\n    const doubled = a * 2;\n    return doubled + 1;\n}\n\nexport class Nested {\n    method(v:number) { return v * 3 + 7; }\n}\n';
    fs.writeFileSync(uri.fsPath,original); git('add','.'); git('commit','-m','symbol fixture');
    const staged = original.replace('original','renamed').replace('+ 1','+ 2');
    fs.writeFileSync(uri.fsPath,staged); git('add','A.ts');
    const doc = await vscode.workspace.openTextDocument(uri);
    let editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    const dirty = '// unsaved prefix\n'+staged.replace('+ 2','+ 9');
    await editor.edit(b => b.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),dirty));
    const api = await vscode.extensions.getExtension('davidmashburn.bygone').activate();
    await vscode.commands.executeCommand('bygone.followActiveEditor');
    const controller = api.controller;
    const msg = () => api.provider.activeState === api.provider.panels.get('follow') ? api.provider.currentMessage : api.provider.panels.get('follow')?.currentMessage;
    const ready = () => until(() => msg()?.editBinding && msg().rightContent === doc.getText(), 'working render');
    await ready();
    const panel = api.provider.panels.get('follow').panel;
    async function buffers() {
        let value; const requestId = Date.now();
        const listener = panel.webview.onDidReceiveMessage(m => { if (m.type === 'navigationState' && m.requestId === requestId) value = m.buffers; });
        try { await panel.webview.postMessage({ type:'captureNavigationState', requestId, flushEditors:true }); await until(() => value,'renderer buffers'); return value; }
        finally { listener.dispose(); }
    }
    async function rendererEdit(start,end,text) {
        await until(() => api.renders>0,'Monaco render');
        await panel.webview.postMessage({ type:'testEdit',start,end,text });
    }
    async function action(action) { await panel.webview.postMessage({ type:'testAction',action }); }
    try {
        const gitApi = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
        await until(() => gitApi.getRepository(uri),'Git repository');
        const repo = gitApi.getRepository(uri); await repo.status();
        await test('SCM group actions separate HEAD/index from index/dirty working text',async () => {
            await vscode.commands.executeCommand('bygone.openStagedInBygone',{resourceUri:uri});
            await until(() => msg()?.leftContent === original && msg().rightContent === staged,'staged snapshots');
            assert.deepEqual(msg().editableSides,{left:false,right:false});
            await vscode.commands.executeCommand('bygone.openWorkingInBygone',{resourceUri:uri}); await ready();
            assert.equal(msg().leftContent,staged); assert.equal(msg().rightContent,dirty);
        });
        await test('Monaco edits update unsaved TextDocument; shared undo/redo and Save',async () => {
            await until(async () => (await buffers()).find(b=>b.id==='right').content === dirty,'renderer current');
            await rendererEdit(dirty.indexOf('+ 9')+2,dirty.indexOf('+ 9')+3,'42');
            const changed = dirty.replace('+ 9','+ 42');
            await until(() => doc.getText()===changed && msg().rightContent===changed,'Bygone write');
            assert.equal(fs.readFileSync(uri.fsPath,'utf8'),staged); assert.equal(git('show',':A.ts')+'\n',staged);
            await action('undo'); await until(() => doc.getText()===dirty,'shared undo');
            await action('redo'); await until(() => doc.getText()===changed,'shared redo');
            await action('save'); await until(() => !doc.isDirty,'save underlying document');
            assert.equal(fs.readFileSync(uri.fsPath,'utf8'),changed); assert.equal(git('show',':A.ts')+'\n',staged);
        });
        await test('provider selection focuses a renamed symbol without changing comparison',async () => {
            editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            editor.selection = new vscode.Selection(doc.positionAt(doc.getText().indexOf('return doubled')),doc.positionAt(doc.getText().indexOf('return doubled')));
            await until(async () => (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider',uri))?.length,'TypeScript symbols');
            await controller.compareSymbol(editor);
            await until(() => controller.focus?.right && msg().rightContent.startsWith('export function renamed'),'symbol slice');
            assert.equal(controller.target.policy,'index-working');
            assert.match(msg().leftContent,/function renamed/); assert.doesNotMatch(msg().rightContent,/class Nested/);
            const before = doc.getText(), slice = msg().rightContent;
            await until(async () => (await buffers()).find(b=>b.id==='right').content===slice,'slice renderer');
            await rendererEdit(slice.indexOf('+ 42')+2,slice.indexOf('+ 42')+4,'51');
            await until(() => doc.getText()===before.replace('+ 42','+ 51'),'slice granular edit');
            assert.equal(doc.getText().slice(doc.getText().indexOf('export class')),before.slice(before.indexOf('export class')));
        });
        await test('range tracks prefix edits and temporary syntax errors',async () => {
            const start = controller.focus.right.start, oldToken = msg().editBinding.token;
            editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await editor.edit(b=>b.insert(new vscode.Position(0,0),'// moved\n'));
            await until(() => controller.focus.right.start===start+9 && msg().editBinding?.token !== oldToken && msg().rightContent.startsWith('export function'),'range movement');
            const slice = msg().rightContent;
            await until(async () => (await buffers()).find(b=>b.id==='right').content===slice,'moved renderer');
            await rendererEdit(slice.length-1,slice.length,'');
            await until(() => msg().rightContent.endsWith('\n') && controller.focus?.right,'invalid syntax editable range');
            const invalid = msg().rightContent; await rendererEdit(invalid.length,invalid.length,'}');
            await until(() => msg().rightContent.endsWith('}') && doc.getText().includes('class Nested'),'syntax repaired');
        });
        await test('stale slice write cannot overwrite a native edit; recovery retains draft',async () => {
            const token=msg().editBinding.token, before=msg().rightContent;
            editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await editor.edit(b=>b.insert(new vscode.Position(0,0),'// concurrent\n'));
            const authoritative=doc.getText();
            await controller.receive({type:'followEdit',id:999,token,content:before+' attempted'});
            assert.equal(doc.getText(),authoritative);
            await controller.receive({type:'followRecover',token,content:before+' attempted'});
            assert.ok(vscode.workspace.textDocuments.some(d=>d.isUntitled && d.getText()===before+' attempted'));
        });
        await test('VS Code rejects a racing WorkspaceEdit before it can apply stale ranges',async () => {
            await controller.action('file'); await ready();
            const before=doc.getText(), token=msg().editBinding.token;
            const native=new vscode.WorkspaceEdit(); native.insert(uri,new vscode.Position(0,0),'// races RPC\n');
            // Both requests leave the host with the same document version. The main thread
            // receives the native edit first, then must reject the stale Bygone edit.
            const nativeWrite=vscode.workspace.applyEdit(native);
            const bygoneWrite=controller.receive({type:'followEdit',id:1000,token,content:before.replace('+ 51','+ 999')});
            await Promise.all([nativeWrite,bygoneWrite]);
            assert.equal(doc.getText(),'// races RPC\n'+before);
            await ready();
        });
        await test('renderer composition events and rapid edits keep the whole unsaved draft',async () => {
            await controller.action('file'); await ready();
            await until(async ()=>(await buffers()).find(b=>b.id==='right').content===doc.getText(),'composition renderer');
            const before=doc.getText();
            await panel.webview.postMessage({type:'testComposition',phase:'start'});
            await rendererEdit(0,0,'// 候'); await rendererEdit(4,4,'補\n');
            await until(async ()=>(await buffers()).find(b=>b.id==='right').content.startsWith('// 候補'),'composed local draft');
            assert.equal(doc.getText(),before);
            const token=msg().editBinding.token;
            controller.refresh();
            await until(()=>msg().editBinding?.token!==token,'unchanged refresh during composition');
            await panel.webview.postMessage({type:'testComposition',phase:'end'});
            await until(()=>doc.getText()==='// 候補\n'+before,'composition commit');
            await until(async ()=>(await buffers()).find(b=>b.id==='right').content===doc.getText(),'rapid renderer');
            await rendererEdit(0,0,'// rapid one\n'); await rendererEdit(0,0,'// rapid two\n');
            await until(()=>doc.getText().startsWith('// rapid two\n// rapid one\n// 候補') && msg().rightContent===doc.getText(),'rapid queued edits');
        });
        await test('staged dirty-buffer symbol selection maps snapshots instead of reusing offsets',async () => {
            await vscode.commands.executeCommand('bygone.openStagedInBygone',{resourceUri:uri});
            await until(() => msg().rightContent===staged,'staged full file');
            editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            editor.selection=new vscode.Selection(doc.positionAt(doc.getText().indexOf('return doubled')),doc.positionAt(doc.getText().indexOf('return doubled')));
            await controller.compareSymbol(editor);
            await until(() => controller.focus || /no verified mapping/.test(msg().follow.status),'staged mapping');
            if (controller.focus) { assert.match(msg().rightContent,/\+ 2/); assert.doesNotMatch(msg().rightContent,/\+ 51|concurrent/); assert.equal(msg().editableSides.right,false); }
            else assert.equal(msg().rightContent,staged);
        });
        await test('native Git events refresh live snapshots and preserve pinned snapshots',async () => {
            await controller.action('file'); await until(()=>msg().rightContent===staged,'full staged');
            controller.pin(); await until(()=>msg().follow.mode==='pinned','pin');
            await doc.save(); git('add','A.ts'); await repo.status();
            await until(()=>/Git state advanced/.test(msg().follow.status),'pinned Git notice'); assert.equal(msg().rightContent,staged);
            controller.resume(); await until(()=>msg().rightContent===doc.getText(),'resume current index');
            assert.equal(controller.target.policy,'head-index');
            git('reset','HEAD','A.ts'); await repo.status(); await until(()=>msg().leftContent===original && msg().rightContent===original,'unstage live refresh');
            assert.equal(controller.target.policy,'head-index');
        });
        await test('opt-in SCM diff tabs resolve exact endpoints',async () => {
            await vscode.workspace.getConfiguration('bygone').update('followScmDiffs',true,vscode.ConfigurationTarget.Global);
            const gitUri=ref=>uri.with({scheme:'git',query:JSON.stringify({path:uri.fsPath,ref})});
            await vscode.commands.executeCommand('vscode.diff',gitUri('~'),uri,'Working SCM',{viewColumn:vscode.ViewColumn.One});
            await until(()=>controller.target.policy==='index-working' && msg().rightContent===doc.getText(),'working diff');
            await vscode.commands.executeCommand('vscode.diff',gitUri('HEAD'),gitUri(''),'Staged SCM',{viewColumn:vscode.ViewColumn.One});
            await until(()=>controller.target.policy==='head-index' && msg().rightContent===original,'staged diff');
        });
        await test('pinned working slices stay editable; oversize edits recover without changing source',async () => {
            editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await controller.openScm('index-working',uri); await ready();
            editor.selection = new vscode.Selection(doc.positionAt(doc.getText().indexOf('return doubled')),doc.positionAt(doc.getText().indexOf('return doubled')));
            await controller.compareSymbol(editor); await until(()=>msg().editBinding && controller.focus?.right,'working focus');
            controller.pin(); await until(()=>msg().follow.mode==='pinned','working pin');
            const before=doc.getText(), slice=msg().rightContent;
            await until(async ()=>(await buffers()).find(b=>b.id==='right').content===slice,'pinned renderer');
            await rendererEdit(slice.indexOf('+ 51')+2,slice.indexOf('+ 51')+4,'61');
            await until(()=>doc.getText()===before.replace('+ 51','+ 61'),'pinned slice write');
            const token=msg().editBinding.token, authoritative=doc.getText(), large='x'.repeat(300000);
            await controller.receive({type:'followDraft',token,content:large});
            await controller.receive({type:'followEdit',id:1001,token,content:large});
            assert.equal(doc.getText(),authoritative);
            await controller.receive({type:'followRecover',token,content:large});
            assert.ok(vscode.workspace.textDocuments.some(d=>d.isUntitled && d.getText()===large));
        });
        await test('external format/replacement invalidates a slice; automatic cursor following preserves SCM policy',async () => {
            editor=await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            const text=doc.getText();
            await editor.edit(b=>b.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(text.length)),text.replaceAll('    ','  ')));
            await until(()=>!controller.focus && msg().rightContent===doc.getText(),'format fallback');
            controller.resume(); await ready();
            await vscode.workspace.getConfiguration('bygone').update('followSymbol',true,vscode.ConfigurationTarget.Global);
            const offset=doc.getText().indexOf('return v');
            editor.selection=new vscode.Selection(doc.positionAt(offset),doc.positionAt(offset));
            // VS Code's Go to Symbol/Outline emit a command selection. Exercise that public navigation path.
            await vscode.commands.executeCommand('cursorMove',{to:'right',by:'character',value:1});
            await until(()=>controller.focus?.right && msg().rightContent.startsWith('method'),'nested cursor symbol');
            assert.equal(controller.target.policy,'index-working'); assert.doesNotMatch(msg().rightContent,/function renamed/);
            await vscode.workspace.getConfiguration('bygone').update('followSymbol',false,vscode.ConfigurationTarget.Global);
            await controller.action('file'); await ready();
        });
        await test('manual and following panels share updates and reject a stale manual draft',async () => {
            const other=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'B.ts')));
            await api.provider.showDiff(other.uri,uri,other.getText(),doc.getText(),msg().diffModel);
            const manual=api.provider.activeState;
            await until(()=>api.provider.activeState===manual && api.provider.isReady,'manual panel');
            const before=doc.getText();
            const edit=new vscode.WorkspaceEdit(); edit.insert(uri,new vscode.Position(0,0),'// multi panel\n'); await vscode.workspace.applyEdit(edit);
            await until(()=>msg().rightContent===doc.getText() && (api.provider.activeState===manual ? api.provider.currentMessage : manual.currentMessage).rightContent===doc.getText(),'both panels update');
            api.provider.queueDocumentUpdate(manual,other.getText(),before+'// stale',other.getText(),before);
            await api.provider.documentUpdateQueue;
            assert.ok(doc.getText().startsWith('// multi panel'));
            assert.ok(vscode.workspace.textDocuments.some(d=>d.isUntitled && d.getText()===before+'// stale'));
            manual.panel.dispose();
            editor=await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await controller.openScm('index-working',uri); await ready();
        });
        await test('staged reveal opens exact read-only index; unmatched dirty symbols retain staged file context',async () => {
            await controller.openScm('head-index',uri); await until(()=>msg().rightContent===original,'staged for reveal');
            await controller.action('reveal');
            await until(()=>vscode.window.activeTextEditor?.document.uri.scheme==='bygone-snapshot','snapshot source');
            assert.equal(vscode.window.activeTextEditor.document.getText(),original);
            editor=await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await editor.edit(b=>b.insert(doc.positionAt(doc.getText().length),'\nexport function brandNewUnique() { return "brand new"; }\n'));
            editor.selection=new vscode.Selection(doc.positionAt(doc.getText().indexOf('brand new')),doc.positionAt(doc.getText().indexOf('brand new')));
            await controller.compareSymbol(editor);
            await until(()=>/no verified mapping/.test(msg().follow.status),'unmatched fallback');
            assert.equal(msg().rightContent,original); assert.equal(controller.focus,undefined);
        });
        await test('snapshot policies ignore invalid bytes outside their selected endpoints',async () => {
            const value=vscode.Uri.file(path.join(root,'policy.ts'));
            fs.writeFileSync(value.fsPath,'export const policy = 1;\n'); git('add','policy.ts'); git('commit','-m','policy fixture');
            fs.writeFileSync(value.fsPath,'export const policy = 2;\n'); git('add','policy.ts');
            fs.writeFileSync(value.fsPath,Buffer.from([0,1,2])); await repo.status();
            await controller.openScm('head-index',value); await until(()=>msg().rightContent.includes('policy = 2'),'staged ignores binary worktree');
            fs.writeFileSync(value.fsPath,'x'.repeat(150000)); git('add','policy.ts');
            fs.writeFileSync(value.fsPath,'export const policy = 3;\n'); await repo.status();
            await vscode.window.showTextDocument(vscode.Uri.file(path.join(root,'B.ts')),{viewColumn:vscode.ViewColumn.One});
            await vscode.window.showTextDocument(value,{viewColumn:vscode.ViewColumn.One});
            await until(()=>controller.target.policy==='head-working' && msg().rightContent.includes('policy = 3'),'HEAD working ignores oversized index');
            git('reset','HEAD','policy.ts');
        });
        await test('added, deleted and renamed SCM files retain exact endpoint paths',async () => {
            const added=vscode.Uri.file(path.join(root,'added.ts')); fs.writeFileSync(added.fsPath,'export const added = 1;\n'); git('add','added.ts'); await repo.status();
            await controller.openScm('head-index',added); await until(()=>msg().rightContent.includes('const added'),'added staged');
            assert.equal(msg().leftContent,''); assert.match(msg().follow.status,/No baseline/);
            git('mv','B.ts','renamed.ts'); await repo.status();
            const renamed=vscode.Uri.file(path.join(root,'renamed.ts'));
            await controller.openScm('head-index',renamed); await until(()=>controller.target.rightPath===renamed.fsPath && msg().rightContent.includes('function b'),'rename staged');
            assert.equal(controller.target.leftPath,path.join(root,'B.ts')); assert.equal(msg().leftContent,msg().rightContent);
            fs.unlinkSync(path.join(root,'C.ts')); git('add','C.ts'); await repo.status();
            await controller.openScm('head-index',vscode.Uri.file(path.join(root,'C.ts'))); await until(()=>msg().leftContent.includes('function c') && msg().rightContent==='','staged deletion');
            assert.deepEqual(msg().editableSides,{left:false,right:false});
            fs.unlinkSync(added.fsPath); await repo.status();
            await controller.openScm('index-working',added); await until(()=>msg().leftContent.includes('const added') && msg().rightContent==='','working deletion');
            assert.equal(msg().editableSides.right,false);
        });
        await test('native discard, commit and branch checkout refresh the same live context',async () => {
            const tracked=vscode.Uri.file(path.join(root,'renamed.ts'));
            fs.writeFileSync(tracked.fsPath,'export function b() { return 2; }\n'); await repo.status();
            await controller.openScm('index-working',tracked); await until(()=>msg().rightContent.includes('return 2'),'working change');
            git('checkout','--','renamed.ts'); await repo.status(); await until(()=>msg().leftContent===msg().rightContent && msg().rightContent.includes('return 1'),'discard');
            await controller.openScm('head-index',tracked);
            await until(()=>msg().leftContent===msg().rightContent && controller.target.leftPath===path.join(root,'B.ts'),'staged rename before commit');
            await doc.save(); git('add','.'); git('commit','-m','SCM fixture lifecycle'); await repo.status();
            await until(()=>controller.target.leftPath===tracked.fsPath && msg().leftContent===msg().rightContent,'rename identity after commit');
            await controller.openScm('head-index',tracked); await until(()=>msg().leftContent===msg().rightContent && msg().rightContent.includes('return 1'),'commit refresh');
            const branch=git('branch','--show-current'); git('checkout','-b','fixture-next');
            fs.writeFileSync(tracked.fsPath,'export function b() { return 3; }\n'); git('add','.'); git('commit','-m','new branch fixture'); await repo.status();
            await until(()=>msg().leftContent.includes('return 3') && msg().rightContent.includes('return 3'),'new branch');
            git('checkout',branch); await repo.status(); await until(()=>msg().leftContent.includes('return 1') && msg().rightContent.includes('return 1'),'checkout refresh');
        });
        await test('disabled Git reports SCM unavailability while explicit comparisons remain usable',async () => {
            const config=vscode.workspace.getConfiguration('git');
            try {
                await config.update('enabled',false,vscode.ConfigurationTarget.Global);
                await until(()=>!controller.git.repository(uri),'Git API disconnected');
                await controller.openScm('head-index',uri);
                await until(()=>msg().follow.unavailable && /Git integration is unavailable/.test(msg().follow.status),'SCM unavailable');
                const other=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'renamed.ts')));
                await api.provider.showDiff(other.uri,uri,other.getText(),doc.getText(),msg().diffModel);
                const manual=api.provider.activeState;
                await until(()=>api.provider.isReady,'manual without Git');
                assert.equal(api.provider.currentMessage.rightContent,doc.getText());
                manual.panel.dispose();
            } finally {
                await config.update('enabled',true,vscode.ConfigurationTarget.Global);
                await until(()=>controller.git.repository(uri),'Git API reconnected');
            }
        });
        await test('closing a session preserves pending text and reload recovery clears only its own draft',async () => {
            editor=await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One});
            await controller.openScm('index-working',uri); await ready();
            const content=msg().rightContent+'// pending close';
            await controller.receive({type:'followDraft',token:msg().editBinding.token,content});
            panel.dispose();
            await until(()=>vscode.workspace.textDocuments.some(d=>d.isUntitled && d.getText()===content),'closed draft recovery');
            await until(()=>controller.storage.get('bygone.followDraft')===undefined,'persisted recovery cleared');
            await controller.storage.update('bygone.followDraft',{content:'reload draft',language:'typescript'});
            const restored=new controller.constructor(api.provider,undefined,controller.storage);
            await until(()=>vscode.workspace.textDocuments.some(d=>d.isUntitled && d.getText()==='reload draft'),'reload recovery');
            restored.dispose();
        });
        console.log('SCM INTEGRATION COMPLETE');
    } catch(error) { console.error('SCM STATE',JSON.stringify({message:{left:msg()?.leftContent?.slice(0,200),right:msg()?.rightContent?.slice(0,200),follow:msg()?.follow},target:controller.target,focus:controller.focus})); throw error; }
    finally { panel.dispose(); }
};
