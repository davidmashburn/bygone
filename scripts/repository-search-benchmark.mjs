import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startRepositorySearch } = require('../out/repositorySearch.js');
const fileCount = positiveInteger('BYGONE_SEARCH_BENCH_FILES', 4_000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-search-bench-'));

try {
    for (let index = 0; index < fileCount; index += 1) {
        const directory = path.join(root, `module-${index % 40}`);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
            path.join(directory, `fixture-${index}.txt`),
            index % 113 === 0 ? `ordinary fixture\nBYGONE_NEEDLE_${index}\n` : `ordinary fixture ${index}\n`,
            'utf8'
        );
    }

    const literal = await benchmark('literal', { pattern: 'BYGONE_NEEDLE_', literal: true });
    const regex = await benchmark('regex', { pattern: 'BYGONE_NEEDLE_[0-9]+', literal: false });
    console.log(`Repository search fixture: ${fileCount.toLocaleString()} generated OSS files`);
    print(literal);
    print(regex);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

async function benchmark(label, query) {
    let observed = 0;
    const startedAt = performance.now();
    const handle = startRepositorySearch({ root, ...query, maxResults: 10_000 }, () => { observed += 1; });
    const completion = await handle.completion;
    const elapsed = performance.now() - startedAt;
    if (completion.kind !== 'complete') throw new Error(`${label} search failed: ${completion.message || completion.kind}`);
    return { label, elapsed, observed, truncated: completion.truncated };
}

function print(result) {
    console.log(`${result.label.padEnd(8)} ${result.elapsed.toFixed(1)}ms, ${result.observed} matches, truncated=${result.truncated}`);
}

function positiveInteger(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
