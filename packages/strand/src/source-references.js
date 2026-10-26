'use strict';

const { createHash } = require('node:crypto');
const { inputProblem, LIMITS } = require('./input');

const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const key = ref => JSON.stringify([ref.revision, ref.path, ref.start, ref.end, ref.digest]);

function identifier(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 100000) {
        throw new TypeError('Expected bounded nonempty identifier');
    }
    return value;
}

/** Revision identifiers are opaque; the host must give immutable snapshots distinct IDs. */
function parseSourceRef(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected source reference');
    const revision = identifier(value.revision), path = identifier(value.path);
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.includes('\0')
        || path.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new TypeError('Invalid relative source path');
    }
    if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || value.start < 0 || value.end <= value.start) {
        throw new TypeError('Invalid UTF-16 range');
    }
    if (typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)) throw new TypeError('Expected SHA-256');
    return { revision, path, start: value.start, end: value.end, digest: value.digest };
}

function checkSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Expected snapshot');
    identifier(snapshot.revision);
    const problem = inputProblem(snapshot.files, {}, LIMITS);
    if (problem) throw new TypeError(problem);
}

function sourceAt(snapshot, path) {
    return Object.prototype.hasOwnProperty.call(snapshot.files, path) ? snapshot.files[path] : undefined;
}

function pinSourceRef(snapshot, path, start, end) {
    checkSnapshot(snapshot);
    const ref = parseSourceRef({ revision: snapshot.revision, path, start, end, digest: '0'.repeat(64) });
    const text = sourceAt(snapshot, ref.path);
    if (typeof text !== 'string' || end > text.length) throw new TypeError('Source is unavailable or range exceeds file');
    return { ...ref, digest: digest(text.slice(start, end)) };
}

function resolveChecked(ref, snapshot) {
    if (snapshot.revision !== ref.revision) return { status: 'broken', reason: 'Revision unavailable in this comparison' };
    const text = sourceAt(snapshot, ref.path);
    if (typeof text !== 'string' || ref.end > text.length) return { status: 'broken', reason: 'Source path or range unavailable' };
    const slice = text.slice(ref.start, ref.end);
    if (digest(slice) !== ref.digest) return { status: 'broken', reason: 'Source digest mismatch' };
    return { status: 'valid', text: slice };
}

function resolveSourceRef(value, snapshot) {
    const ref = parseSourceRef(value);
    checkSnapshot(snapshot);
    return resolveChecked(ref, snapshot);
}

function boundedList(value) {
    if (!Array.isArray(value) || value.length > LIMITS.maxRecords) throw new TypeError('Expected bounded reference array');
    return value;
}

/** Follows complete accepted pairs only; endpoint validity does not establish correspondence. */
function relocateSourceRefs(values, before, after, pairs) {
    checkSnapshot(before);
    checkSnapshot(after);
    const problem = inputProblem(before.files, after.files, LIMITS);
    if (problem) throw new TypeError(problem);
    if (before.revision === after.revision) throw new TypeError('Relocation requires distinct snapshot revisions');
    const refs = boundedList(values).map(parseSourceRef);
    const candidates = boundedList(pairs).map(pair => {
        if (!pair || typeof pair !== 'object') throw new TypeError('Expected correspondence pair');
        return { before: parseSourceRef(pair.before), after: parseSourceRef(pair.after) };
    });
    const destinations = new Map(), usedAfter = new Set();
    for (const pair of candidates) {
        const from = key(pair.before), to = key(pair.after);
        if (destinations.has(from) || usedAfter.has(to)) throw new TypeError('Duplicate correspondence endpoint');
        destinations.set(from, pair.after);
        usedAfter.add(to);
    }
    for (const pair of candidates) {
        if (resolveChecked(pair.before, before).status !== 'valid' || resolveChecked(pair.after, after).status !== 'valid') {
            throw new TypeError('Invalid correspondence endpoint');
        }
    }
    return refs.map(ref => {
        let destination;
        if (resolveChecked(ref, before).status === 'valid') {
            destination = sourceAt(before, ref.path) === sourceAt(after, ref.path)
                ? { ...ref, revision: after.revision } : destinations.get(key(ref));
        }
        if (!destination) return { status: 'unresolved', before: ref };
        const status = ref.digest !== destination.digest ? 'changed'
            : ref.path !== destination.path || ref.start !== destination.start ? 'relocated' : 'unchanged';
        return { status, before: ref, after: { ...destination } };
    });
}

module.exports = { parseSourceRef, pinSourceRef, resolveSourceRef, relocateSourceRefs };
