const { execFileSync } = require('child_process');
const { realpathSync } = require('fs');
const path = require('path');
const { parseNameStatusZ } = require('../out/gitComparison.js');

function git(root, args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function validatePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
        path.posix.isAbsolute(value) || value.split('/').some(part => part === '..' || part === '.' || !part)) {
        throw new Error('History requires a repository-relative file path.');
    }
    return value;
}

function validateCommit(root, value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value)) {
        throw new Error('History requires a full Git commit ID.');
    }
    const resolved = git(root, ['rev-parse', '--verify', `${value}^{commit}`]).trim();
    if (resolved !== value.toLowerCase()) throw new Error('History commit could not be resolved.');
    return resolved;
}

function createTourHistory(manifest) {
    if (manifest.version !== 2) return null;
    let root;
    try {
        root = realpathSync(manifest.repository.root);
        if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('Wrong repository root');
        validateCommit(root, manifest.range.headOid);
        validateCommit(root, manifest.range.mergeBaseOid);
    } catch {
        throw new Error('This v2 tour requires its originating Git repository. Restore the repository before presenting it.');
    }
    return {
        list(input) {
            const filePath = validatePath(input.path);
            const commit = validateCommit(root, input.commit || manifest.range.headOid);
            // Follow the file backwards from the requested revision, including deleted
            // files and rename records; no working-tree file needs to exist.
            const output = git(root, ['--literal-pathspecs', 'log', '--follow', '-M', '--max-count=250',
                '--format=%x1e%H%x00%P%x00%s%x00%cI%x00', '--name-status', '-z', commit, '--', filePath]);
            const entries = [];
            let historicalPath = filePath;
            for (const record of output.split('\x1e').slice(1)) {
                const fields = record.split('\0');
                const [oid, parents, summary, timestamp] = fields;
                const changes = parseNameStatusZ(fields.slice(4).join('\0').replace(/^\0?\n/, ''));
                const change = changes.find(item => item.path === historicalPath || item.previousPath === historicalPath) || changes[0];
                if (!change) continue;
                entries.push({ commit: oid, oid, parentCommit: parents.split(' ')[0] || null,
                    shortCommit: oid.slice(0, 7), summary, timestamp, path: change.path,
                    ...(change.previousPath ? { previousPath: change.previousPath } : {}) });
                historicalPath = change.previousPath || change.path;
            }
            return { entries, selectedIndex: entries.length ? 0 : -1, selectedCommit: entries[0]?.commit || null,
                ...(entries[0]?.commit !== commit ? { fallback: entries.length
                    ? 'Showing the closest preceding commit that changed this file.'
                    : 'No file history exists at this revision.' } : {}) };
        },
        diff(input) {
            const filePath = validatePath(input.path);
            const commit = validateCommit(root, input.commit);
            const parents = git(root, ['show', '-s', '--format=%P', commit]).trim();
            const parentCommit = parents.split(' ')[0] || null;
            const changes = parseNameStatusZ(git(root, ['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z',
                ...(parentCommit ? [parentCommit, commit] : [commit])]));
            const change = changes.find(item => item.path === filePath || item.previousPath === filePath);
            const rightPath = change?.path || filePath;
            const leftPath = change?.previousPath || filePath;
            function read(oid, name, absent) {
                if (!oid || absent) return '';
                const content = git(root, ['show', `${oid}:${name}`]);
                if (content.includes('\0') || content.length > 2 * 1024 * 1024) throw new Error('History file is binary or too large to display.');
                return content;
            }
            return { commit, parentCommit, path: rightPath,
                ...(change?.previousPath ? { previousPath: change.previousPath } : {}),
                leftContent: read(parentCommit, leftPath, change?.kind === 'added'),
                rightContent: read(commit, rightPath, change?.kind === 'deleted'),
                leftLabel: `${leftPath} @ ${parentCommit ? parentCommit.slice(0, 7) : 'empty'}`,
                rightLabel: `${rightPath} @ ${commit.slice(0, 7)}` };
        }
    };
}

module.exports = { createTourHistory, validatePath };
