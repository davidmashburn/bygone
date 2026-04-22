import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildDirectoryComparison } = require('../out/directoryDiff.js');
const { GitHistoryService } = require('../out/gitHistory.js');

const BENCH_ITERATIONS = readPositiveIntegerEnv('BYGONE_PERF_BENCH_ITERATIONS', 8);
const BENCH_WARMUP = readPositiveIntegerEnv('BYGONE_PERF_BENCH_WARMUP', 2);
const DIRECTORY_FILE_COUNT = readPositiveIntegerEnv('BYGONE_PERF_BENCH_DIR_FILES', 320);
const DIRECTORY_LARGE_FILE_BYTES = readPositiveIntegerEnv('BYGONE_PERF_BENCH_LARGE_FILE_BYTES', 384 * 1024);
const HISTORY_COMMIT_COUNT = readPositiveIntegerEnv('BYGONE_PERF_BENCH_HISTORY_COMMITS', 120);

let benchmarkSink = 0;

function main() {
    const directoryFixture = createDirectoryFixture();
    const historyFixture = createHistoryFixture();

    try {
        console.log('Bygone performance benchmarks');
        console.log(`Iterations: ${BENCH_ITERATIONS} (warmup: ${BENCH_WARMUP})`);
        console.log('');

        const directoryLegacy = runBenchmark('Directory compare (legacy full-read)', () => {
            const entries = buildDirectoryComparisonLegacy(directoryFixture.leftDir, directoryFixture.rightDir);
            consumeResult(entries);
        });
        const directoryCurrent = runBenchmark('Directory compare (current)', () => {
            const entries = buildDirectoryComparison(directoryFixture.leftDir, directoryFixture.rightDir);
            consumeResult(entries);
        });

        const historyService = new GitHistoryService();
        const historyLegacy = runBenchmark('History descriptors (legacy per-parent metadata)', () => {
            const descriptors = buildFileHistoryDescriptorsLegacy(historyFixture.filePath);
            consumeResult(descriptors);
        });
        const historyCurrent = runBenchmark('History descriptors (current batched metadata)', () => {
            const descriptors = historyService.buildFileHistoryDescriptors(historyFixture.filePath);
            consumeResult(descriptors);
        });

        printSection('Directory compare', directoryLegacy, directoryCurrent, {
            files: DIRECTORY_FILE_COUNT,
            largeFileBytes: DIRECTORY_LARGE_FILE_BYTES
        });
        printSection('History descriptors', historyLegacy, historyCurrent, {
            commits: HISTORY_COMMIT_COUNT
        });

        console.log(`Benchmark sink: ${benchmarkSink}`);
    } finally {
        safeRm(directoryFixture.rootDir);
        safeRm(historyFixture.repoDir);
    }
}

function createDirectoryFixture() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-perf-dir-'));
    const leftDir = path.join(rootDir, 'left');
    const rightDir = path.join(rootDir, 'right');
    fs.mkdirSync(leftDir, { recursive: true });
    fs.mkdirSync(rightDir, { recursive: true });

    for (let index = 0; index < DIRECTORY_FILE_COUNT; index += 1) {
        const moduleName = `module-${String(index % 24).padStart(2, '0')}`;
        const fileName = `file-${String(index).padStart(4, '0')}.txt`;
        const relativePath = path.join(moduleName, fileName);
        const leftPath = path.join(leftDir, relativePath);
        const rightPath = path.join(rightDir, relativePath);
        fs.mkdirSync(path.dirname(leftPath), { recursive: true });
        fs.mkdirSync(path.dirname(rightPath), { recursive: true });

        const baseContent = index % 17 === 0
            ? `large-${index}\n${'x'.repeat(DIRECTORY_LARGE_FILE_BYTES)}\n`
            : `small-${index}\n${'a'.repeat(3072)}\n`;
        fs.writeFileSync(leftPath, baseContent, 'utf8');

        const rightContent = index % 29 === 0
            ? `${baseContent}mutated-${index}\n`
            : baseContent;
        fs.writeFileSync(rightPath, rightContent, 'utf8');
    }

    fs.writeFileSync(path.join(leftDir, 'left-only.txt'), 'left only\n', 'utf8');
    fs.writeFileSync(path.join(rightDir, 'right-only.txt'), 'right only\n', 'utf8');

    return { rootDir, leftDir, rightDir };
}

function createHistoryFixture() {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-perf-history-'));
    runGit(repoDir, ['init']);
    runGit(repoDir, ['config', 'user.name', 'Bygone Bench']);
    runGit(repoDir, ['config', 'user.email', 'bygone-bench@example.com']);

    const filePath = path.join(repoDir, 'history-target.txt');
    for (let index = 0; index < HISTORY_COMMIT_COUNT; index += 1) {
        const chunk = `commit-${index}\n${'x'.repeat(128)}\n`;
        if (index === 0) {
            fs.writeFileSync(filePath, chunk, 'utf8');
            runGit(repoDir, ['add', 'history-target.txt']);
        } else {
            fs.appendFileSync(filePath, chunk, 'utf8');
            runGit(repoDir, ['add', 'history-target.txt']);
        }
        runGit(repoDir, ['commit', '-m', `commit ${index}`]);
    }

    return { repoDir, filePath };
}

function runBenchmark(label, fn) {
    for (let index = 0; index < BENCH_WARMUP; index += 1) {
        fn();
    }

    const samples = [];
    for (let index = 0; index < BENCH_ITERATIONS; index += 1) {
        const startedAt = performance.now();
        fn();
        samples.push(performance.now() - startedAt);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const avg = total / samples.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    return {
        label,
        samples,
        avg,
        p95,
        min,
        max
    };
}

function printSection(section, legacy, current, fixtureSummary) {
    console.log(`${section}:`);
    console.log(`  Fixture: ${formatFixtureSummary(fixtureSummary)}`);
    console.log(`  ${legacy.label.padEnd(48)} avg=${formatDuration(legacy.avg)} p95=${formatDuration(legacy.p95)} min=${formatDuration(legacy.min)} max=${formatDuration(legacy.max)}`);
    console.log(`  ${current.label.padEnd(48)} avg=${formatDuration(current.avg)} p95=${formatDuration(current.p95)} min=${formatDuration(current.min)} max=${formatDuration(current.max)}`);
    console.log(`  Speedup: ${formatSpeedup(legacy.avg, current.avg)}`);
    console.log('');
}

function formatFixtureSummary(summary) {
    return Object.entries(summary)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
}

function formatSpeedup(legacyAvg, currentAvg) {
    if (currentAvg <= 0) {
        return 'n/a';
    }

    return `${(legacyAvg / currentAvg).toFixed(2)}x`;
}

function formatDuration(value) {
    return `${value.toFixed(2)}ms`;
}

function buildDirectoryComparisonLegacy(leftDir, rightDir) {
    return buildDirectoryComparisonLegacyForRoots([leftDir, rightDir]);
}

function buildDirectoryComparisonLegacyForRoots(roots) {
    const entries = [];
    collectLegacyEntries(roots, '', 0, entries);
    return entries;
}

function collectLegacyEntries(roots, relativeDir, depth, result) {
    const entryMaps = roots.map((root) => new Map(safeReadDir(path.join(root, relativeDir)).map((entry) => [entry.name, entry])));
    let hasChanges = false;

    const allNames = [...new Set(entryMaps.flatMap((entryMap) => [...entryMap.keys()]))]
        .filter((name) => !name.startsWith('.'))
        .sort((left, right) => {
            const leftIsDir = entryMaps.some((entryMap) => entryMap.get(left)?.isDirectory() ?? false);
            const rightIsDir = entryMaps.some((entryMap) => entryMap.get(right)?.isDirectory() ?? false);
            if (leftIsDir !== rightIsDir) {
                return leftIsDir ? -1 : 1;
            }
            return left.localeCompare(right);
        });

    for (const name of allNames) {
        const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
        const sideEntries = entryMaps.map((entryMap) => entryMap.get(name));
        const sides = sideEntries.map(Boolean);
        const isDirectory = sideEntries.some((entry) => entry?.isDirectory() ?? false);

        result.push({
            relativePath: isDirectory ? `${relativePath}/` : relativePath,
            displayName: name,
            depth,
            isDirectory,
            status: 'same',
            sides
        });
        const entryIndex = result.length - 1;

        let childrenChanged = false;
        if (isDirectory) {
            childrenChanged = collectLegacyEntries(roots, relativePath, depth + 1, result);
        }

        const status = getLegacyEntryStatus(roots, relativePath, sideEntries, sides, isDirectory, childrenChanged);
        result[entryIndex].status = status;
        hasChanges = hasChanges || status !== 'same';
    }

    return hasChanges;
}

function getLegacyEntryStatus(roots, relativePath, entries, sides, isDirectory, childrenChanged) {
    const presentCount = sides.filter(Boolean).length;
    if (presentCount === 0) {
        return 'same';
    }

    if (presentCount < roots.length) {
        return sides[0] ? 'left-only' : 'right-only';
    }

    if (isDirectory) {
        const allDirectories = entries.every((entry) => entry?.isDirectory());
        return allDirectories && !childrenChanged ? 'same' : 'modified';
    }

    return fileContentsEqualLegacy(roots.map((root) => path.join(root, relativePath))) ? 'same' : 'modified';
}

function fileContentsEqualLegacy(filePaths) {
    try {
        const files = filePaths.map((filePath) => fs.readFileSync(filePath));
        const [first, ...rest] = files;
        if (!first) {
            return false;
        }
        return rest.every((buffer) => buffer.equals(first));
    } catch {
        return false;
    }
}

function safeReadDir(dirPath) {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

function buildFileHistoryDescriptorsLegacy(filePath) {
    const canonicalFilePath = fs.realpathSync(filePath);
    const repoRoot = fs.realpathSync(runGit(path.dirname(canonicalFilePath), ['rev-parse', '--show-toplevel']));
    const relativePath = path.relative(repoRoot, canonicalFilePath).replace(/\\/g, '/');
    const commits = parseHistoryCommitRecords(runGit(
        repoRoot,
        ['log', '--follow', '--format=%H%x09%h%x09%cI%x09%s%x09%P', '--', relativePath]
    ));

    return commits
        .map((commit) => {
            if (!commit.parentCommit) {
                return undefined;
            }

            const parentMetadata = readCommitMetadataLegacy(repoRoot, commit.parentCommit);
            return {
                commit: commit.commit,
                parentCommit: commit.parentCommit,
                shortCommit: commit.shortCommit,
                summary: commit.summary,
                timestamp: commit.timestamp,
                parentSummary: parentMetadata.summary,
                parentTimestamp: parentMetadata.timestamp
            };
        })
        .filter((entry) => Boolean(entry));
}

function parseHistoryCommitRecords(logOutput) {
    return logOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const parts = line.split('\t');
            const hasParentField = parts.length >= 5;
            const parentField = hasParentField ? (parts[parts.length - 1] || '') : '';
            const summaryParts = hasParentField ? parts.slice(3, -1) : parts.slice(3);
            const firstParentCommit = parentField.split(' ').find((candidate) => candidate.length > 0);
            return {
                commit: parts[0],
                shortCommit: parts[1],
                timestamp: parts[2],
                summary: summaryParts.join('\t'),
                parentCommit: firstParentCommit
            };
        });
}

function readCommitMetadataLegacy(repoRoot, commit) {
    const output = runGit(repoRoot, ['show', '-s', '--format=%cI%x09%s', commit]);
    const [timestamp = '', ...summaryParts] = output.split('\t');
    return {
        timestamp,
        summary: summaryParts.join('\t')
    };
}

function runGit(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024
    }).trimEnd();
}

function consumeResult(value) {
    if (Array.isArray(value)) {
        benchmarkSink += value.length;
        return;
    }

    if (typeof value === 'number') {
        benchmarkSink += value;
    }
}

function safeRm(targetPath) {
    if (!targetPath) {
        return;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
}

function readPositiveIntegerEnv(name, fallback) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main();
