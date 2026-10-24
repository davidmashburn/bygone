const { createHash } = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');

function correspondenceTreeFixture() {
    const kept = 'def kept(self):\n        return 1';
    const orphan = 'def uncertain(self):\n        return 2';
    const stable = `class Stable:\n    ${kept}\n\n    ${orphan}`;
    const nested = 'def nested():\n            return 3';
    const oldMethod = `def old_name(self):\n        ${nested}\n        return 4`;
    const newMethod = `def new_name(self):\n        ${nested}\n        return 5`;
    const oldWork = `class Work:\n    ${oldMethod}`;
    const newWork = `class Work:\n    ${newMethod}`;
    const transfer = 'def transfer():\n    return 6';
    const prior = 'def prior_only():\n    return 7';
    const fresh = 'def fresh_only():\n    return 8';
    const before = { 'src/outline.py': `${stable}\n\n${oldWork}\n\n${transfer}\n\n${prior}\n` };
    const after = { 'src/outline.py': `${stable}\n\n${newWork}\n\n${fresh}\n`, 'src/moved.py': `${transfer}\n` };
    const files = { before, after };
    const symbols = { before: [], after: [] };
    const add = (side, path, name, kind, text) => {
        const content = files[side][path], start = content.indexOf(text), end = start + text.length;
        if (start < 0) throw new Error('Missing fixture declaration');
        const entry = { id: `${side}-${name}`, path, name, kind, start, end, text, digest: hash(text),
            startLine: content.slice(0, start).split('\n').length, endLine: content.slice(0, end).split('\n').length };
        symbols[side].push(entry); return entry;
    };
    for (const side of ['before', 'after']) {
        const path = 'src/outline.py';
        add(side, path, 'Stable', 'class', stable);
        add(side, path, 'kept', 'method', kept);
        add(side, path, 'uncertain', 'method', orphan);
        add(side, path, 'Work', 'class', side === 'before' ? oldWork : newWork);
        add(side, path, side === 'before' ? 'old_name' : 'new_name', 'method', side === 'before' ? oldMethod : newMethod);
        add(side, path, 'nested', 'function', nested);
    }
    add('before', 'src/outline.py', 'transfer', 'function', transfer);
    add('after', 'src/moved.py', 'transfer', 'function', transfer);
    add('before', 'src/outline.py', 'prior_only', 'function', prior);
    add('after', 'src/outline.py', 'fresh_only', 'function', fresh);
    const pairs = ['Stable', 'kept', 'Work', 'nested', 'transfer'].map(name => [name, name]);
    pairs.push(['old_name', 'new_name']);
    const relations = pairs.map(([a, b]) => {
        const source = symbols.before.find(e => e.name === a), destination = symbols.after.find(e => e.name === b);
        return { id: `relation-${a}`, sourceId: source.id, destinationId: destination.id,
            producers: ['exact-declaration'], pathChanged: source.path !== destination.path,
            nameChanged: a !== b, rawEqual: source.text === destination.text, behavior: 'unassessed', localDiff: [] };
    });
    const artifact = { version: 1, range: { baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) },
        producer: 'synthetic-tree-fixture', status: 'complete', symbols, relations,
        documents: Object.fromEntries(['before', 'after'].map(side => [side, Object.entries(files[side]).map(([path, text]) => ({ path, digest: hash(text), status: 'complete' }))])),
        unresolved: [{ reason: 'competing-origins', sourceIds: ['before-uncertain'], destinationIds: ['after-uncertain'] }], limitations: [] };
    return { before, after, artifact };
}
module.exports = { correspondenceTreeFixture };
