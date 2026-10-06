import { diffLines } from 'diff';

/** Read-only, path-scoped queries against an exported snapshot. No host calls. */
export function createExportHistory(data) {
    const manifest = data.manifest;
    const graph = data.history;
    const endpoints = [manifest.range.mergeBaseOid, manifest.range.headOid];
    const entry = (oid) => {
        const found = graph?.commits.find(commit => commit.oid === oid);
        if (!found) throw new Error(`Revision ${oid} is outside this export.`);
        return found;
    };
    const snapshot = (oid, path) => {
        entry(oid);
        if (!graph.paths.includes(path)) throw new Error(`File ${path} is outside this export.`);
        const value = graph.snapshots[oid][path];
        if (value?.omitted) throw new Error(`${path}: ${value.omitted}`);
        return value ? data.texts[value.blob] : null;
    };
    const ancestors = (oid) => {
        const seen = new Set();
        const visit = (id) => {
            if (seen.has(id) || !graph.commits.some(commit => commit.oid === id)) return;
            seen.add(id); entry(id).parents.forEach(visit);
        };
        visit(oid);
        return seen;
    };
    const statistics = (left, right) => diffLines(left || '', right || '').reduce((stats, part) => {
        if (part.added) stats.additions += part.count;
        if (part.removed) stats.deletions += part.count;
        return stats;
    }, { additions: 0, deletions: 0 });
    return async (endpoint, input) => {
        if (endpoint === 'compare-many') {
            const commits = input.commits;
            if (!Array.isArray(commits) || commits.length < 2 || new Set(commits).size !== commits.length) throw new Error('Select at least two different included revisions.');
            if (!graph) {
                if (commits.length !== 2 || commits.some((oid, index) => oid !== endpoints[index])) throw new Error('Minimal exports support only the fixed base → head comparison.');
                if (input.path && !manifest.files.some(file => file.path === input.path || file.previousPath === input.path)) throw new Error('File is outside the exported scope.');
                return { commits, files: manifest.files.filter(file => !input.path || file.path === input.path || file.previousPath === input.path).map(file => ({
                    ...file,
                    comparisonPanels: commits.map((commit, index) => ({
                        id: `compare-${commit}`, commit, editable: false,
                        path: index === 0 ? file.previousPath || file.path : file.path,
                        label: index === 0 ? file.leftLabel : file.rightLabel,
                        content: (index === 0 ? file.leftContent : file.rightContent) || ''
                    }))
                })) };
            }
            commits.forEach(entry);
            if (input.path && !graph.paths.includes(input.path)) throw new Error('File is outside the exported scope.');
            const paths = input.path ? [input.path] : graph.paths;
            return { commits, files: paths.flatMap(path => {
                const records = commits.map(oid => graph.snapshots[oid][path]);
                if (!input.path && records.every(record => JSON.stringify(record) === JSON.stringify(records[0]))) return [];
                const omitted = records.find(record => record?.omitted);
                const contents = records.map(record => record?.blob ? data.texts[record.blob] : '');
                const stats = contents.slice(1).reduce((total, text, index) => {
                    const delta = statistics(contents[index], text);
                    return { additions: total.additions + delta.additions, deletions: total.deletions + delta.deletions };
                }, { additions: 0, deletions: 0 });
                return [{ kind: omitted ? 'omitted' : 'text-diff', path, ...stats,
                    ...(omitted ? { reason: omitted.omitted } : {}),
                    changeKind: !records[0] ? 'added' : !records.at(-1) ? 'deleted' : 'modified',
                    comparisonPanels: commits.map((commit, index) => ({ id: `compare-${commit}`, commit, path,
                        label: `${path} @ ${commit.slice(0, 7)}${records[index] ? '' : ' (absent)'}`, content: contents[index], editable: false }))
                }];
            }) };
        }
        if (!graph) throw new Error('Git history is not included in this Minimal export.');
        const commit = input.commit || manifest.range.headOid;
        const current = entry(commit);
        if (endpoint === 'list') {
            const included = ancestors(commit);
            let entries = graph.commits.filter(item => included.has(item.oid));
            if (input.path) {
                if (!graph.paths.includes(input.path)) throw new Error('File is outside the exported scope.');
                entries = entries.filter(item => {
                    const parent = graph.snapshots[item.parents[0]];
                    return !parent || JSON.stringify(graph.snapshots[item.oid][input.path]) !== JSON.stringify(parent[input.path]);
                });
            }
            return { entries, selectedIndex: entries.length ? 0 : -1, selectedCommit: entries[0]?.oid || null };
        }
        if (endpoint === 'diff') {
            const parentCommit = current.parents[0] || null;
            if (parentCommit && !graph.snapshots[parentCommit]) throw new Error('The parent revision is outside this export. Compare two included revisions instead.');
            const leftContent = parentCommit ? snapshot(parentCommit, input.path) : null;
            const rightContent = snapshot(commit, input.path);
            return { commit, parentCommit, path: input.path,
                leftContent: leftContent || '', rightContent: rightContent || '',
                leftLabel: `${input.path} @ ${parentCommit?.slice(0, 7) || 'empty'}`,
                rightLabel: `${input.path} @ ${commit.slice(0, 7)}` };
        }
        throw new Error(`Unsupported export operation: ${endpoint}.`);
    };
}
