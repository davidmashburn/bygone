// Diagnostic report for move-tracking slice 0: prints Bygone's exact relations
// beside Git's --color-moved=blocks baseline for each corpus case.
// Usage: npm run compile && node scripts/move-tracking-report.mjs [filter]
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { analyzeMoves, formatMoveAnalysis } = require('../out/moveTracking.js');
const corpus = require('../test/moveTrackingCorpus.js');

const OLD_MOVED = '\x1b[35m-';
const NEW_MOVED = '\x1b[36m+';

function gitMovedLines(left, right) {
    const dir = mkdtempSync(join(tmpdir(), 'bygone-move-report-'));
    try {
        writeFileSync(join(dir, 'left'), left);
        writeFileSync(join(dir, 'right'), right);
        let output = '';
        try {
            execFileSync('git', ['-c', 'color.diff.oldMoved=magenta', '-c', 'color.diff.newMoved=cyan',
                'diff', '--no-index', '--color=always', '--color-moved=blocks', 'left', 'right'], { cwd: dir, encoding: 'utf8' });
        } catch (error) {
            // `git diff --no-index` exits 1 when the files differ.
            if (error.status !== 1) throw error;
            output = error.stdout;
        }
        const lines = output.split('\n');
        return { removed: lines.filter(line => line.startsWith(OLD_MOVED)).length, added: lines.filter(line => line.startsWith(NEW_MOVED)).length };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const filter = process.argv[2]?.toLowerCase();
for (const testCase of corpus) {
    if (filter && !testCase.name.toLowerCase().includes(filter)) continue;
    const left = corpus.textOf(testCase, 'left');
    const right = corpus.textOf(testCase, 'right');
    const git = gitMovedLines(left, right);
    console.log(`## ${testCase.name}`);
    if (testCase.target) console.log(`target: ${testCase.target}`);
    console.log(formatMoveAnalysis(analyzeMoves(left, right)));
    console.log(`git --color-moved=blocks: moved -${git.removed}/+${git.added}\n`);
}
