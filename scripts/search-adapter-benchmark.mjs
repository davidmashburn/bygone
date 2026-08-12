import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { searchChangeSetSnapshots } = require('../out/changeSetSearch.js');
const { searchFileHistory } = require('../out/gitHistorySearch.js');
const { searchTour } = require('../out/tourSearch.js');

const budgetMs = positiveInteger('BYGONE_SEARCH_ADAPTER_BUDGET_MS', 1_000);
const lineBlock = Array.from({ length: 400 }, (_value, index) => `export const fixture_${index} = ${index};`).join('\n');
const snapshots = Array.from({ length: 120 }, (_value, index) => ({
    relativePath: `src/fixture-${index}.ts`, sideIndex: 1, label: `fixture-${index}`,
    content: `${lineBlock}\n${index % 17 === 0 ? 'BYGONE_ADAPTER_NEEDLE' : 'ordinary'}\n`
}));
const historyEntries = Array.from({ length: 250 }, (_value, index) => ({
    commit: `commit-${index}`, parentCommit: `commit-${index + 1}`, shortCommit: String(index).padStart(7, '0'),
    summary: `fixture revision ${index}`, timestamp: '', parentSummary: '', parentTimestamp: '',
    leftLabel: 'parent', rightLabel: 'commit', leftContent: lineBlock,
    rightContent: `${lineBlock}\n${index % 31 === 0 ? 'BYGONE_ADAPTER_NEEDLE' : 'ordinary'}\n`
}));
const tour = {
    chapters: [{ id: 'fixtures', title: 'Fixture narrative', sceneIds: ['scene'] }],
    scenes: [{
        id: 'scene', kind: 'discussion', title: 'Search fixture', summary: 'Generated open-source benchmark content.',
        bullets: ['BYGONE_ADAPTER_NEEDLE'], tags: ['benchmark'], takeaway: 'Bound the in-memory adapters.'
    }],
    files: snapshots.map((snapshot, index) => ({
        id: `file-${index}`, kind: 'text-diff', path: snapshot.relativePath,
        leftContent: lineBlock, rightContent: snapshot.content
    }))
};

const results = [
    benchmark('change set', () => searchChangeSetSnapshots(snapshots, 'BYGONE_ADAPTER_NEEDLE', { limit: 1_000 })),
    benchmark('Git history', () => searchFileHistory(historyEntries, 'BYGONE_ADAPTER_NEEDLE', 'content', { limit: 1_000 })),
    benchmark('tour', () => searchTour(tour, 'BYGONE_ADAPTER_NEEDLE', 'all', 1_000))
];

for (const result of results) {
    console.log(`${result.label.padEnd(12)} ${result.elapsed.toFixed(1)}ms, ${result.matchCount} matches / ${budgetMs}ms budget`);
    if (result.elapsed > budgetMs) throw new Error(`${result.label} exceeded the ${budgetMs}ms adapter budget.`);
}

function benchmark(label, run) {
    const startedAt = performance.now();
    const matches = run();
    return { label, elapsed: performance.now() - startedAt, matchCount: matches.length };
}

function positiveInteger(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
