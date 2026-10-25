const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { minimalEdit, trackRange, isFollowEdit } = require('../out/followEdits');
const { analyzeLiveSymbols } = require('../out/liveSymbols');

test('minimal edits preserve unrelated UTF-16 text and line endings', () => {
    for (const [before, after] of [['a😀b', 'a😁b'], ['a\r\nb', 'a\r\nx\r\nb'], ['abcd','abXYZd'], ['','x'], ['x','']]) {
        const change = minimalEdit(before, after);
        assert.equal(before.slice(0, change.rangeOffset)+change.text+before.slice(change.rangeOffset+change.rangeLength), after);
    }
});
test('range tracks before/inside edits and rejects external deletion/replacement', () => {
    assert.deepEqual(trackRange({ start: 10, end: 20 }, [{ rangeOffset: 1, rangeLength: 0, text: 'abc' }]), { start: 13, end: 23 });
    assert.deepEqual(trackRange({ start: 10, end: 20 }, [{ rangeOffset: 15, rangeLength: 2, text: 'abc' }]), { start: 10, end: 21 });
    assert.equal(trackRange({ start: 10, end: 20 }, [{ rangeOffset: 10, rangeLength: 10, text: 'new symbol' }]), undefined);
    assert.equal(trackRange({ start: 10, end: 20 }, [{ rangeOffset: 0, rangeLength: 30, text: '' }]), undefined);
    assert.equal(isFollowEdit({ type: 'followEdit', id: 1, token: '1', content: 'x' }), true);
    assert.equal(isFollowEdit({ type: 'followEdit', id: NaN, token: '1', content: 'x' }), false);
});
async function protocol() { return import('data:text/javascript;base64,'+fs.readFileSync(require.resolve('../media/followSync.js')).toString('base64')); }
test('rapid typing serializes acknowledgments without replacing the queued suffix', async () => {
    const { createFollowSync } = await protocol(); const sent = []; let text = 'a';
    const sync = createFollowSync({ send: m => sent.push(m), read: () => text });
    sync.receive({ type: 'showDiff', editBinding: { token: '1', projection: 'file' } });
    sync.changed(); text = 'ab'; sync.changed();
    assert.equal(sent.filter(m => m.type === 'followEdit').length, 1);
    assert.equal(sync.receive({ type: 'showDiff', rightContent: 'external', editBinding: { token: '2', projection: 'file' } }), false);
    assert.equal(sync.receive({ type: 'showDiff', rightContent: 'a', followAck: { id: 1, accepted: true }, editBinding: { token: '3', projection: 'file' } }), false);
    assert.equal(sent.at(-1).content, 'ab'); assert.equal(sent.at(-1).token, '3');
    assert.deepEqual(sent.at(-2), { type: 'followDraft', token: '3', content: 'ab' });
    sync.action('save');
    assert.equal(sync.receive({ type: 'showDiff', rightContent: 'ab', followAck: { id: 2, accepted: true }, editBinding: { token: '4', projection: 'file' } }), true);
    assert.deepEqual(sent.at(-1), { type: 'followAction', action: 'save' });
});
test('concurrent native edit rejection preserves the entire pending draft', async () => {
    const { createFollowSync } = await protocol(); const sent = []; let text = 'typed';
    const sync = createFollowSync({ send: m => sent.push(m), read: () => text });
    sync.receive({ type: 'showDiff', editBinding: { token: '1', projection: 'slice' } });
    sync.changed(); text += ' tail'; sync.changed();
    sync.receive({ type: 'showDiff', followAck: { id: 1, accepted: false } });
    assert.deepEqual(sent.at(-1), { type: 'followRecover', token: '1', content: 'typed tail' });
});
test('snapshot adapter uses Strand evidence for rename and rejects unsupported languages', async () => {
    const before = 'export function oldName(a:number) { const doubled = a * 2; return doubled + 1; }';
    const after = '\n\n'+before.replace('oldName','newName').replace('+ 1','+ 2');
    const start = performance.now();
    const result = await analyzeLiveSymbols('old.ts','new.ts',before,after);
    console.log('LIVE SYMBOL cold worker ms', Math.round(performance.now()-start));
    assert.equal(result.pairs.length, 1); assert.equal(result.pairs[0].destination.start, 2);
    assert.equal(result.pairs[0].source.name, 'oldName'); assert.equal(result.pairs[0].destination.name, 'newName');
    await assert.rejects(analyzeLiveSymbols('a.py','a.py','x','y'), /JavaScript and TypeScript/);
    const canceled = new AbortController(); canceled.abort();
    await assert.rejects(analyzeLiveSymbols('a.ts','a.ts',before,after,canceled.signal), /canceled/);
});
test('IME composition retains intermediate text until the composition commits', async () => {
    const { createFollowSync } = await protocol(); const sent = []; let text = '候';
    const sync = createFollowSync({send:m=>sent.push(m),read:()=>text});
    sync.receive({type:'showDiff',editBinding:{token:'1',projection:'file'}});
    sync.compositionStart(); sync.changed(); text='候補'; sync.changed();
    assert.equal(sent.filter(m=>m.type==='followEdit').length,0);
    assert.equal(sync.receive({type:'showDiff',rightContent:'external',editBinding:{token:'2',projection:'file'}}),false);
    sync.compositionEnd(); assert.equal(sent.at(-1).content,'候補'); assert.equal(sent.at(-1).token,'1');
});
test('snapshot validation rejects tampered offsets/digests and cancels active workers', async () => {
    const { validSymbol, snapshotDigest } = require('../out/liveSymbols');
    const text='export const x = 1;'; const value={start:0,end:text.length,digest:snapshotDigest(text)};
    assert.equal(validSymbol(value,text),true);
    assert.equal(validSymbol({...value,start:1},text),false);
    assert.equal(validSymbol({...value,digest:'untrusted'},text),false);
    const controller=new AbortController(); const pending=analyzeLiveSymbols('a.ts','a.ts',text,text,controller.signal); controller.abort();
    await assert.rejects(pending,/canceled/);
});
test('composition ending without edits releases a deferred source refresh', async () => {
    const { createFollowSync } = await protocol();
    const sent=[];
    const sync=createFollowSync({send:m=>sent.push(m),read:()=>''});
    sync.receive({type:'showDiff',editBinding:{token:'1',projection:'file'}});
    sync.compositionStart();
    const refresh={type:'showDiff',rightContent:'native update',editBinding:{token:'2',projection:'file'}};
    assert.equal(sync.receive(refresh),false);
    const deferred=sync.compositionEnd();
    assert.equal(deferred,refresh);
    assert.equal(sync.receive(deferred),true);
    assert.equal(sync.state().binding.token,'2');
    assert.deepEqual(sent,[]);
});
test('duplicate method names retain structural identity, and additions remain unmatched', async () => {
    const left='class Alpha { same(a) { return a * 2 + 1; } }\nclass Beta { same(b) { return b.toUpperCase(); } }';
    const right=left.replace('2 + 1','2 + 3')+'\nfunction newlyAdded() { return ["unique", 17]; }';
    const result=await analyzeLiveSymbols('a.js','a.js',left,right);
    for (const pair of result.pairs) {
        if (pair.source.qualifiedName?.includes('Alpha')) assert.ok(pair.destination.qualifiedName.includes('Alpha'));
        if (pair.source.qualifiedName?.includes('Beta')) assert.ok(pair.destination.qualifiedName.includes('Beta'));
        assert.notEqual(pair.destination.name,'newlyAdded');
    }
    assert.ok(result.right.some(s=>s.name==='newlyAdded'));
    assert.ok(result.pairs.some(p=>p.source.name==='same'));
});
