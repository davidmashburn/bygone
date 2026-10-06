// Original, deterministic public fixture used by the visual walkthrough.
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '/tmp/bygone-visual-demo');
mkdirSync(root, { recursive: true });
const repo = path.join(root, 'parcel');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-b', 'main');
git('config', 'user.name', 'Bygone Demo');
git('config', 'user.email', 'demo@example.invalid');
const versions = [
`// Parcel — a small release planner\nexport function planRelease(packages) {\n  const plan = [];\n\n  for (const pkg of packages) {\n    plan.push({\n      name: pkg.name,\n      version: pkg.version,\n      publish: true,\n    });\n  }\n\n  return plan;\n}\n`,
`// Parcel — a small release planner\nexport function planRelease(packages) {\n  const plan = [];\n\n  for (const pkg of packages) {\n    if (pkg.private) continue;\n\n    plan.push({\n      name: pkg.name,\n      version: pkg.version,\n      publish: true,\n    });\n  }\n\n  return plan;\n}\n`,
`// Parcel — a small release planner\nexport function planRelease(packages, options = {}) {\n  const plan = [];\n  const dryRun = options.dryRun ?? true;\n\n  for (const pkg of packages) {\n    if (pkg.private) continue;\n\n    plan.push({\n      name: pkg.name,\n      version: pkg.version,\n      publish: !dryRun,\n    });\n  }\n\n  return plan;\n}\n`,
`// Parcel — a small release planner\nexport function planRelease(packages, options = {}) {\n  const plan = [];\n  const dryRun = options.dryRun ?? true;\n\n  for (const pkg of packages) {\n    if (pkg.private) continue;\n    if (!pkg.version) {\n      throw new Error('A release needs a version');\n    }\n\n    plan.push({\n      name: pkg.name,\n      version: pkg.version,\n      publish: !dryRun,\n    });\n  }\n\n  return plan;\n}\n`,
`// Parcel — a small release planner\nexport function planRelease(packages, options = {}) {\n  const plan = [];\n  const dryRun = options.dryRun ?? true;\n\n  for (const pkg of packages) {\n    if (pkg.private) continue;\n    if (!pkg.version) {\n      throw new Error('A release needs a version');\n    }\n\n    plan.push({\n      name: pkg.name,\n      version: pkg.version,\n      publish: !dryRun,\n      channel: options.channel ?? 'stable',\n    });\n  }\n\n  return plan.sort((a, b) => a.name.localeCompare(b.name));\n}\n`
];
const titles = ['Start the release planner', 'Skip private packages', 'Default to a safe dry run', 'Reject missing versions', 'Sort releases and name their channel'];
const revisions = [];
for (let i = 0; i < versions.length; i++) {
  writeFileSync(path.join(repo, 'release.js'), versions[i]);
  writeFileSync(path.join(repo, 'README.md'), `# Parcel\n\nA small release planner.\n\n${titles.slice(0, i + 1).map(t => `- ${t}`).join('\n')}\n`);
  writeFileSync(path.join(repo, 'release.yaml'), `release:\n  channel: ${i === 4 ? 'stable' : 'preview'}\n  dryRun: ${i >= 2}\n  packages:\n    - name: parcel-core\n      version: 1.2.0\n    - name: parcel-cli\n      version: 1.2.0\n`);
  if (i === 4) writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Release 1.2\n\nSafe defaults, explicit channels, predictable ordering.\n');
  git('add', '.');
  execFileSync('git', ['commit', '-m', titles[i]], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: `2026-09-0${i+1}T12:00:00Z`, GIT_COMMITTER_DATE: `2026-09-0${i+1}T12:00:00Z` } });
  revisions.push(git('rev-parse', 'HEAD'));
  writeFileSync(path.join(root, `release-v${i+1}.js`), versions[i]);
  if (i === 0 || i === 4) {
    const dir = path.join(root, i === 0 ? 'before' : 'after');
    mkdirSync(dir);
    for (const file of git('ls-files').split('\n')) cpSync(path.join(repo, file), path.join(dir, file));
  }
}
const source = {
  version: 4, title: 'Ship a safer release plan', range: { base: revisions[0], head: revisions[4] },
  anchors: {
    dry: { file: 'release.js', revision: 'head', contains: '  const dryRun = options.dryRun ?? true;' },
    private: { file: 'release.js', revision: 'head', contains: '    if (pkg.private) continue;' },
    stable: { file: 'release.js', revision: 'head', contains: "      channel: options.channel ?? 'stable'," }
  }, connections: [], chapters: [{ id: 'safety', title: 'Make the safe path the easy path', scenes: [{
    id: 'planner', title: 'A release should be deliberate', summary: 'Parcel turns package metadata into a release plan. This change makes safety the default and keeps the result predictable.',
    bullets: ['Preview before publishing.', 'Keep private packages out.', 'Name the release channel.'], tags: ['safety', 'release'], takeaway: 'A plan is inspectable before it becomes a publish operation.',
    steps: [
      { id: 'dry-run', title: 'Preview by default', body: 'Omitting options now creates a dry-run plan. Publishing requires an explicit choice, so a caller can inspect the same plan before allowing side effects.', focus: 'dry' },
      { id: 'private-packages', title: 'Respect the package boundary', body: 'Private packages never enter the plan. Filtering at the boundary means every later stage can operate on publishable packages.', focus: 'private' },
      { id: 'channel', title: 'Make the destination visible', body: 'Each entry carries its release channel. The default is stable; callers can choose another channel when preparing a preview.', focus: 'stable' }
    ]
  }] }]
};
writeFileSync(path.join(root, 'release.bygone'), JSON.stringify(source, null, 2) + '\n');
writeFileSync(path.join(repo, 'release.bygone'), JSON.stringify(source, null, 2) + '\n');
writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ root, repo, revisions }, null, 2));
console.log(root);
