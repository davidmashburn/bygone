import { execFileSync } from 'child_process';
import path from 'path';

const DIRECTORY_MIN_SPEEDUP = readPositiveNumberEnv('BYGONE_PERF_CHECK_MIN_DIRECTORY_SPEEDUP', 0.95);
const HISTORY_MIN_SPEEDUP = readPositiveNumberEnv('BYGONE_PERF_CHECK_MIN_HISTORY_SPEEDUP', 4.0);

function main() {
    const benchmarkOutput = execFileSync(
        process.execPath,
        [path.resolve('scripts/perf-benchmarks.mjs'), '--json'],
        {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit'],
            env: {
                ...process.env,
                BYGONE_PERF_BENCH_ITERATIONS: process.env.BYGONE_PERF_BENCH_ITERATIONS || '5',
                BYGONE_PERF_BENCH_WARMUP: process.env.BYGONE_PERF_BENCH_WARMUP || '1',
                BYGONE_PERF_BENCH_DIR_FILES: process.env.BYGONE_PERF_BENCH_DIR_FILES || '220',
                BYGONE_PERF_BENCH_LARGE_FILE_BYTES: process.env.BYGONE_PERF_BENCH_LARGE_FILE_BYTES || String(192 * 1024),
                BYGONE_PERF_BENCH_HISTORY_COMMITS: process.env.BYGONE_PERF_BENCH_HISTORY_COMMITS || '100'
            }
        }
    );
    const report = JSON.parse(benchmarkOutput);
    const directorySpeedup = report?.sections?.directory?.speedup;
    const historySpeedup = report?.sections?.history?.speedup;

    console.log('Bygone perf check');
    console.log(`  directory speedup: ${formatSpeedup(directorySpeedup)} (min ${DIRECTORY_MIN_SPEEDUP.toFixed(2)}x)`);
    console.log(`  history speedup:   ${formatSpeedup(historySpeedup)} (min ${HISTORY_MIN_SPEEDUP.toFixed(2)}x)`);

    const failures = [];
    if (!Number.isFinite(directorySpeedup) || directorySpeedup < DIRECTORY_MIN_SPEEDUP) {
        failures.push(
            `Directory compare speedup ${formatSpeedup(directorySpeedup)} is below ${DIRECTORY_MIN_SPEEDUP.toFixed(2)}x`
        );
    }
    if (!Number.isFinite(historySpeedup) || historySpeedup < HISTORY_MIN_SPEEDUP) {
        failures.push(
            `History descriptor speedup ${formatSpeedup(historySpeedup)} is below ${HISTORY_MIN_SPEEDUP.toFixed(2)}x`
        );
    }

    if (failures.length > 0) {
        for (const failure of failures) {
            console.error(`FAIL: ${failure}`);
        }
        process.exit(1);
    }

    console.log('Perf check passed.');
}

function formatSpeedup(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}x` : 'n/a';
}

function readPositiveNumberEnv(name, fallback) {
    const parsed = Number.parseFloat(process.env[name] || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main();
