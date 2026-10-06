import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(process.argv[2] || '/tmp/bygone-visual-demo');
const { repo, revisions } = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json')));
const output = 'docs/visual-walkthrough/images';
const captures = [
  ['01-two-files', 'none', '--diff', `${root}/release-v1.js`, `${root}/release-v5.js`],
  ['02-many-panels', 'fit', '--diff', ...[1,2,3,4,5].map(n => `${root}/release-v${n}.js`)],
  ['03-directories', 'none', `${root}/before`, `${root}/after`],
  ['04-search', 'find', '--diff', `${root}/release-v1.js`, `${root}/release-v5.js`],
  ['05-repository-history', 'older', '--history', repo],
  ['06-file-history', 'older', '--history', `${repo}/release.js`],
  ['07-branch-review', 'none', '-C', repo, 'review', '--base', revisions[0]],
  ['12-authoring', 'author', '-C', repo, 'review', '--base', revisions[0]],
];
for (const [name, action, ...args] of captures) {
  const result = spawnSync('node', ['scripts/run-electron.mjs', 'docs/visual-walkthrough/capture-desktop.cjs', `${output}/${name}.png`, action, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
/* global process */
