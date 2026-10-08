const { execFileSync } = require('child_process');
const { realpathSync } = require('fs');
const { TextDecoder } = require('util');
const path = require('path');
const { buildHistoryDirectoryEntries } = require('../out/historyDirectory.js');
const { parseNameStatusZ } = require('../out/gitComparison.js');

const DEFAULT_HISTORY_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_HISTORY_MAX_LINE_BYTES = 64 * 1024;
const DEFAULT_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function git(root, args, options = {}) {
    const encoding = options.encoding || 'utf8';
    const output = execFileSync('git', args, {
        cwd: root,
        encoding,
        maxBuffer: options.maxBuffer || DEFAULT_GIT_MAX_BUFFER_BYTES,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return encoding === 'utf8' ? output.trimEnd() : output;
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
    let resolved;
    try {
        resolved = git(root, ['rev-parse', '--verify', `${value}^{commit}`]).trim();
    } catch {
        throw new Error('History commit could not be resolved.');
    }
    if (resolved !== value.toLowerCase()) throw new Error('History commit could not be resolved.');
    return resolved;
}

function requireInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('History requires a request object.');
    }
    return input;
}

function listCommitHistory(root, commit) {
    const output = git(root, ['log', '--topo-order', '--format=%x1e%H%x00%P%x00%s%x00%cI%x00%an%x00%ae%x00%B%x00', commit, '--']);
    const entries = [];
    for (const record of output.split('\x1e').slice(1)) {
        const fields = record.split('\0');
        const [oid, parents, summary, timestamp, author, authorEmail, message] = fields;
        if (!oid) continue;
        entries.push({
            commit: oid,
            oid,
            parentCommit: parents.split(' ')[0] || null,
            parents: parents.split(' ').filter(Boolean),
            shortCommit: oid.slice(0, 7),
            summary,
            timestamp, author, authorEmail, message: message.trimEnd()
        });
    }
    return entries;
}

function listChangedPaths(root, from, to) {
    return parseNameStatusZ(git(root, [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '-z',
        '--find-renames',
        '--find-copies',
        from,
        to,
        '--'
    ]));
}

function pathPair(changedPath) {
    const followsPath = (changedPath.kind === 'renamed' || changedPath.kind === 'copied')
        && Boolean(changedPath.previousPath);
    return {
        leftPath: changedPath.kind === 'added'
            ? null
            : followsPath ? changedPath.previousPath : changedPath.path,
        rightPath: changedPath.kind === 'deleted' ? null : changedPath.path
    };
}

function parseNumstatValue(value) {
    if (value === '-') return 0;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readNumstats(root, from, to) {
    const fields = git(root, [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--numstat',
        '-z',
        '--find-renames',
        '--find-copies',
        from,
        to,
        '--'
    ]).split('\0');
    const stats = [];
    for (let index = 0; index < fields.length;) {
        const header = fields[index++];
        if (!header) continue;
        const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(header);
        if (!match) continue;
        const stat = {
            additions: parseNumstatValue(match[1]),
            deletions: parseNumstatValue(match[2])
        };
        if (match[3]) {
            stat.path = match[3];
        } else {
            // With -z, rename and copy records put their two paths in the
            // following NUL-delimited fields.
            stat.previousPath = fields[index++] || undefined;
            stat.path = fields[index++] || undefined;
        }
        if (stat.path) stats.push(stat);
    }
    return stats;
}

function buildStatsMap(stats) {
    const byPath = new Map();
    for (const stat of stats) {
        byPath.set(stat.path, stat);
        if (stat.previousPath) byPath.set(stat.previousPath, stat);
    }
    return byPath;
}

function hasLineLongerThan(content, maxLineBytes) {
    let lineStart = 0;
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] !== 10) continue;
        if (index - lineStart > maxLineBytes) return true;
        lineStart = index + 1;
    }
    return content.length - lineStart > maxLineBytes;
}

function readGitText(root, oid, relativePath) {
    if (!oid || !relativePath) return { kind: 'text', content: '' };
    let content;
    try {
        content = git(root, ['cat-file', 'blob', `${oid}:${relativePath}`], {
            encoding: 'buffer',
            maxBuffer: DEFAULT_HISTORY_MAX_FILE_BYTES + 1
        });
    } catch (error) {
        if (error && (error.code === 'ENOBUFS' || /maxBuffer|buffer length/i.test(String(error.message)))) {
            return { kind: 'omitted', reason: 'History file is too large to display.' };
        }
        return { kind: 'omitted', reason: 'History file could not be read.' };
    }
    if (content.length > DEFAULT_HISTORY_MAX_FILE_BYTES) {
        return { kind: 'omitted', reason: 'History file is too large to display.' };
    }
    if (content.includes(0)) {
        return { kind: 'omitted', reason: 'Binary history files cannot be displayed.' };
    }
    try {
        // Validate UTF-8 before converting so arbitrary binary data that does
        // not contain a NUL byte is still omitted instead of being replaced.
        new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
        return { kind: 'omitted', reason: 'Binary history files cannot be displayed.' };
    }
    if (hasLineLongerThan(content, DEFAULT_HISTORY_MAX_LINE_BYTES)) {
        return { kind: 'omitted', reason: 'History file contains an oversized line.' };
    }
    return { kind: 'text', content: content.toString('utf8') };
}

function buildComparisonFile(root, from, to, changedPath, statsByPath) {
    const pair = pathPair(changedPath);
    const left = readGitText(root, from, pair.leftPath);
    const right = readGitText(root, to, pair.rightPath);
    const stats = statsByPath.get(changedPath.path) ||
        (changedPath.previousPath ? statsByPath.get(changedPath.previousPath) : undefined);
    const additions = stats?.additions || 0;
    const deletions = stats?.deletions || 0;
    const leftLabel = pair.leftPath
        ? `${pair.leftPath} @ ${from.slice(0, 7)}`
        : `${changedPath.path} (absent)`;
    const rightLabel = pair.rightPath
        ? `${pair.rightPath} @ ${to.slice(0, 7)}`
        : `${changedPath.path} (absent)`;
    const reason = left.kind === 'omitted' ? left.reason : right.kind === 'omitted' ? right.reason : undefined;
    const result = {
        kind: reason ? 'omitted' : 'text-diff',
        path: changedPath.path,
        ...(changedPath.previousPath ? { previousPath: changedPath.previousPath } : {}),
        changeKind: changedPath.kind,
        leftPath: pair.leftPath,
        rightPath: pair.rightPath,
        leftContent: reason ? '' : left.content,
        rightContent: reason ? '' : right.content,
        leftLabel,
        rightLabel,
        additions,
        deletions
    };
    if (reason) result.reason = reason;
    return result;
}

function buildUnchangedPath(root, from, to, filePath) {
    const left = readGitText(root, from, filePath);
    const right = readGitText(root, to, filePath);
    const reason = left.kind === 'omitted' ? left.reason : right.kind === 'omitted' ? right.reason : undefined;
    const result = {
        kind: reason ? 'omitted' : 'text-diff',
        path: filePath,
        changeKind: 'unchanged',
        leftPath: filePath,
        rightPath: filePath,
        leftContent: reason ? '' : left.content,
        rightContent: reason ? '' : right.content,
        leftLabel: `${filePath} @ ${from.slice(0, 7)}`,
        rightLabel: `${filePath} @ ${to.slice(0, 7)}`,
        additions: 0,
        deletions: 0
    };
    if (reason) result.reason = reason;
    return result;
}

function pathExistsAt(root, oid, filePath) {
    try {
        return git(root, ['cat-file', '-e', `${oid}:${filePath}`]) === '';
    } catch {
        return false;
    }
}

function aggregateComparisonFiles(commits, comparisons) {
    const groups = [];
    for (const [pairIndex, comparison] of comparisons.entries()) {
        for (const file of comparison.files) {
            const aliases = [file.path, file.previousPath, file.leftPath, file.rightPath].filter(Boolean);
            const matches = groups.filter(group => aliases.some(alias => group.aliases.has(alias)));
            const group = matches.shift() || { aliases: new Set(), files: [], panels: Array(commits.length).fill(null) };
            if (!groups.includes(group)) groups.push(group);
            for (const duplicate of matches) {
                for (const alias of duplicate.aliases) group.aliases.add(alias);
                group.files.push(...duplicate.files);
                for (let index = 0; index < group.panels.length; index += 1) group.panels[index] ||= duplicate.panels[index];
                groups.splice(groups.indexOf(duplicate), 1);
            }
            for (const alias of aliases) group.aliases.add(alias);
            group.files.push(file);
            if (file.kind === 'text-diff') {
                group.panels[pairIndex] = { content: file.leftContent, path: file.leftPath || file.previousPath || file.path };
                group.panels[pairIndex + 1] = { content: file.rightContent, path: file.rightPath || file.path };
            }
        }
    }
    return groups.map(group => {
        for (let index = 1; index < group.panels.length; index += 1) group.panels[index] ||= group.panels[index - 1];
        for (let index = group.panels.length - 2; index >= 0; index -= 1) group.panels[index] ||= group.panels[index + 1];
        const source = group.files[group.files.length - 1];
        const filePath = [...group.panels].reverse().find(panel => panel?.path)?.path || source.path;
        const omitted = group.files.find(file => file.kind === 'omitted');
        return {
            kind: omitted ? 'omitted' : 'text-diff',
            path: filePath,
            changeKind: source.changeKind,
            additions: group.files.reduce((sum, file) => sum + (file.additions || 0), 0),
            deletions: group.files.reduce((sum, file) => sum + (file.deletions || 0), 0),
            ...(omitted ? { reason: omitted.reason } : {}),
            comparisonPanels: group.panels.map((panel, index) => ({
                id: `compare-${commits[index]}`,
                label: `${panel?.path || filePath} @ ${commits[index].slice(0, 7)}`,
                commit: commits[index],
                path: panel?.path || filePath,
                content: panel?.content || '',
                editable: false
            }))
        };
    });
}

function createTourHistory(manifest) {
    if (manifest.version < 2) return null;
    let root;
    try {
        root = realpathSync(manifest.repository.root);
        if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('Wrong repository root');
        validateCommit(root, manifest.range.headOid);
        validateCommit(root, manifest.range.mergeBaseOid);
    } catch {
        throw new Error('This v2 tour requires its originating Git repository. Restore the repository before presenting it.');
    }
    function compare(input) {
        input = requireInput(input);
        const from = validateCommit(root, input.from);
        const to = validateCommit(root, input.to);
        const changedPaths = listChangedPaths(root, from, to);
        const statsByPath = buildStatsMap(readNumstats(root, from, to));
        if (input.path !== undefined) {
            const filePath = validatePath(input.path);
            const changedPath = changedPaths.find(item => item.path === filePath || item.previousPath === filePath);
            if (changedPath) return { from, to, files: [buildComparisonFile(root, from, to, changedPath, statsByPath)] };
            if (!pathExistsAt(root, from, filePath) && !pathExistsAt(root, to, filePath)) return { from, to, files: [] };
            return { from, to, files: [buildUnchangedPath(root, from, to, filePath)] };
        }
        return { from, to, files: changedPaths.map(changedPath => buildComparisonFile(root, from, to, changedPath, statsByPath)) };
    }
    return {
        list(input) {
            input = requireInput(input);
            if (input.path === undefined) {
                const commit = validateCommit(root, input.commit || manifest.range.headOid);
                const entries = listCommitHistory(root, commit);
                return {
                    entries,
                    selectedIndex: entries.length ? 0 : -1,
                    selectedCommit: entries[0]?.commit || null
                };
            }
            const filePath = validatePath(input.path);
            const commit = validateCommit(root, input.commit || manifest.range.headOid);
            // Follow the file backwards from the requested revision, including deleted
            // files and rename records; no working-tree file needs to exist.
            const output = git(root, ['--literal-pathspecs', 'log', '--topo-order', '--follow', '-M',
                '--format=%x1e%H%x00%P%x00%s%x00%cI%x00%an%x00%ae%x00%B%x00', '--name-status', '-z', commit, '--', filePath]);
            const entries = [];
            let historicalPath = filePath;
            for (const record of output.split('\x1e').slice(1)) {
                const fields = record.split('\0');
                const [oid, parents, summary, timestamp, author, authorEmail, message] = fields;
                const changes = parseNameStatusZ(fields.slice(7).join('\0').replace(/^\0?\n/, ''));
                const change = changes.find(item => item.path === historicalPath || item.previousPath === historicalPath) || changes[0];
                if (!change) continue;
                entries.push({ commit: oid, oid, parentCommit: parents.split(' ')[0] || null,
                    shortCommit: oid.slice(0, 7), summary, timestamp, author, authorEmail, message: message.trimEnd(),
                    parents: parents.split(' ').filter(Boolean), path: change.path,
                    ...(change.previousPath ? { previousPath: change.previousPath } : {}) });
                historicalPath = change.previousPath || change.path;
            }
            return { entries, selectedIndex: entries.length ? 0 : -1, selectedCommit: entries[0]?.commit || null,
                ...(entries[0]?.commit !== commit ? { fallback: entries.length
                    ? 'Showing the closest preceding commit that changed this file.'
                    : 'No file history exists at this revision.' } : {}) };
        },
        revisions(input) {
            input = requireInput(input);
            const commit = validateCommit(root, input.commit || manifest.range.headOid);
            const entries = listCommitHistory(root, commit);
            return {
                revisions: entries,
                entries,
                selectedIndex: entries.length ? 0 : -1,
                selectedCommit: entries[0]?.commit || null
            };
        },
        diff(input) {
            input = requireInput(input);
            let filePath = validatePath(input.path);
            const commit = validateCommit(root, input.commit);
            // Resolve the file's historical name without changing the commit axis.
            // Only cross a rename when this revision is an ancestor of that rename.
            if (input.head && !pathExistsAt(root, commit, filePath)) {
                const head = validateCommit(root, input.head);
                const lineage = this.list({ path: filePath, commit: head }).entries;
                for (const entry of lineage) {
                    if (!entry.previousPath) continue;
                    try {
                        git(root, ['merge-base', '--is-ancestor', commit, entry.parentCommit]);
                        filePath = entry.previousPath;
                    } catch { /* This rename is not ahead of the requested revision. */ }
                    if (pathExistsAt(root, commit, filePath)) break;
                }
            }
            const parents = git(root, ['show', '-s', '--format=%P', commit]).trim();
            const parentCommit = parents.split(' ')[0] || null;
            const changes = parseNameStatusZ(git(root, ['--literal-pathspecs', 'diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z',
                ...(parentCommit ? [parentCommit, commit] : [commit]), '--']));
            const change = changes.find(item => item.path === filePath || item.previousPath === filePath);
            const rightPath = change?.path || filePath;
            const leftPath = change?.previousPath || filePath;
            function read(oid, name, absent) {
                if (!oid || absent || !pathExistsAt(root, oid, name)) return '';
                const content = readGitText(root, oid, name);
                if (content.kind === 'omitted') throw new Error(content.reason);
                return content.content;
            }
            return { commit, parentCommit, path: rightPath,
                ...(change?.previousPath ? { previousPath: change.previousPath } : {}),
                leftContent: read(parentCommit, leftPath, change?.kind === 'added'),
                rightContent: read(commit, rightPath, change?.kind === 'deleted'),
                leftLabel: `${leftPath} @ ${parentCommit ? parentCommit.slice(0, 7) : 'empty'}`,
                rightLabel: `${rightPath} @ ${commit.slice(0, 7)}` };
        },
        compare,
        changedFiles(input) {
            input = requireInput(input);
            if (!Array.isArray(input.commits) || input.commits.length > 32) throw new Error('Expected displayed revisions.');
            const commits = input.commits.map(commit => commit === null ? null : validateCommit(root, commit));
            const paths = new Set();
            for (let index = 1; index < commits.length; index++) {
                const pair = [commits[index - 1], commits[index]];
                if (pair[0] === pair[1]) continue;
                const output = pair.includes(null)
                    ? git(root, ['ls-tree', '-r', '--name-only', '-z', pair.find(Boolean)])
                    : git(root, ['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', ...pair, '--']);
                output.split('\0').filter(Boolean).forEach(file => paths.add(file));
            }
            const changed = [...paths].sort();
            return { paths: changed, ...(input.includeEntries ? {
                entries: buildHistoryDirectoryEntries(changed, commits.map(commit => new Set(commit
                    ? git(root, ['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean) : [])))
            } : {}) };
        },
        compareMany(input) {
            input = requireInput(input);
            if (!Array.isArray(input.commits) || input.commits.length < 2) throw new Error('Comparison requires at least two commits.');
            const commits = input.commits.map(commit => validateCommit(root, commit));
            if (new Set(commits).size !== commits.length) throw new Error('Comparison commits must be unique.');
            const comparisons = commits.slice(0, -1).map((from, index) => compare({
                from,
                to: commits[index + 1],
                ...(input.path !== undefined ? { path: input.path } : {})
            }));
            return {
                commits,
                files: aggregateComparisonFiles(commits, comparisons)
            };
        }
    };
}

module.exports = { createTourHistory, validatePath };
