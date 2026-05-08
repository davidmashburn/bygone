#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const repoRoot = process.cwd();
const walkthroughDir = path.join(repoRoot, 'media', 'walkthrough');
const skipCompile = process.argv.includes('--skip-compile');

const captures = [
    {
        output: path.join(walkthroughDir, 'directory-history.png'),
        args: ['--dir-history', repoRoot]
    },
    {
        output: path.join(walkthroughDir, 'file-history.png'),
        args: ['--history', path.join(repoRoot, 'src', 'fileComparator.ts')]
    },
    {
        output: path.join(walkthroughDir, 'direct-file-diff.png'),
        args: [
            path.join(repoRoot, 'media', 'script.js'),
            path.join(repoRoot, 'media', 'dom.js')
        ]
    }
];

if (!skipCompile) {
    run('npm', ['run', 'compile']);
}

fs.mkdirSync(walkthroughDir, { recursive: true });

for (const capture of captures) {
    run(electronBinary, [
        './out/standalone-main.js',
        '--capture',
        capture.output,
        ...capture.args
    ]);
    console.log(`Wrote ${path.relative(repoRoot, capture.output)}`);
}

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
            ...process.env
        }
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
