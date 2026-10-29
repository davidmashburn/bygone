/* global require, process */
const fs = require('fs');
const { execFileSync } = require('child_process');
try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const { repoRoot, baseOid, headOid } = input;
    if (![baseOid, headOid].every(oid => typeof oid === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))) {
        throw new Error('Dependencies require two pinned commit revisions.');
    }
    const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
    for (const oid of [baseOid, headOid]) if (git(['rev-parse', '--verify', `${oid}^{commit}`]) !== oid) throw new Error('Invalid dependency revision.');
    const range = { repoRoot, baseRef: baseOid, headRef: headOid, baseOid, headOid, mergeBaseOid: baseOid,
        dirty: Boolean(git(['status', '--porcelain', '--untracked-files=no'])), changedPaths: [], commits: [] };
    const report = require('./dependencyEvidence.js').buildDependencyEvidence(repoRoot, { range });
    const correspondence = input.correspondence
        ? require('./changeCorrespondence.js').validateChangeCorrespondence(repoRoot, input.correspondence, { baseOid, headOid }) : undefined;
    const changes = require('./dependencyChanges.js').compareDependencyEvidence(report, correspondence);
    process.stdout.write(JSON.stringify({ report, changes }));
} catch (error) {
    process.stderr.write(String(error.message)); process.exitCode = 1;
}
