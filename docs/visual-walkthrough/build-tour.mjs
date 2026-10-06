// Rebuild prose from its pinned revision, never from an uncommitted draft.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = 'e431a208f5ad24e3fae1a22300a14fc7d041375f';
const head = '32bf8166cf6ae852fa801a540fe722b4070d5f4f';
const folder = 'docs/visual-walkthrough';
const prose = execFileSync('git', ['show', `${head}:${folder}/narrative.md`], { encoding: 'utf8' });
const ids = ['two-files', 'many-panels', 'directories', 'search', 'repository-history', 'file-history', 'branch-review', 'tour-reader', 'focused-step', 'deconstructed', 'exploration', 'authoring', 'export', 'vscode', 'cli'];
const alts = [
  'Two JavaScript files with paired blue changes, green additions, and gutter ribbons connecting the regions.',
  'Three of five JavaScript versions are visible, with Fit selected and the first adjacent pair active.',
  'The before and after directory trees align three modified files and one added changelog.',
  'A search for publish finds one result in each of the two visible comparison panes.',
  'The commit navigator marks two loaded revisions; the comparison shows CHANGELOG.md added in the newest commit.',
  'Two pinned release.js revisions show a new channel field and sorted return value beside the commit navigator.',
  'The branch overview recommends starting with release.yaml, paying attention to release.js, and shows four changed files.',
  'A tour outline and continuous narrative introduce a safer release plan above its changed-file overview.',
  'The Preview by default step sits under a sticky scene heading and highlights the dry-run code evidence below.',
  'Deconstructed tour stages show an explanation baseline beside the Carry every anchor stage, with focused TypeScript changes.',
  'The Files navigator selects release.yaml while the authored narrative remains above; Return to tour is visible.',
  'An authoring dialog contains an editable prompt, pinned review range, and a Read instructions button.',
  'An exported tour has Tour details expanded: minimal snapshot, no browsable history, embedded viewer, no internet required.',
  'VS Code hosts a read-only Bygone file history comparison next to the Explorer and source tabs.',
  'A VS Code terminal displays the CLI usage forms for comparison, history, review, presentation, validation, compilation, and export.'
];
const summaries = [
  'Start with concrete files. The same visual language scales from two versions to directories and search.',
  'Add time to the comparison. Follow a path through commits or begin with the shape of a whole branch.',
  'A tour turns findings into a reading path while leaving room for exploration.',
  'Choose a sharing format and a host that fit the next reader’s question.'
];
let index = 0;
const anchors = {};
const chapters = prose.split(/^## /m).slice(1).map((chapter, c) => {
  const [title, ...sections] = chapter.split(/^### /m);
  const chapterTitle = title.trim();
  const steps = sections.map(section => {
    const newline = section.indexOf('\n');
    const title = section.slice(0, newline).trim();
    const body = section.slice(newline).trim().replace(/\n(?!\n)/g, ' ');
    const id = ids[index];
    anchors[id] = { file: `${folder}/narrative.md`, revision: 'head', contains: `### ${title}` };
    const image = { file: `${folder}/images/${String(index + 1).padStart(2, '0')}-${id}.png`, revision: 'head', alt: alts[index] };
    index++;
    return { id, title, body, focus: id, depth: 'explained', image };
  });
  return { id: `chapter-${c + 1}`, title: chapterTitle, scenes: [{
    id: `arc-${c + 1}`, title: chapterTitle, summary: summaries[c], bullets: [], tags: ['visual-guide'],
    takeaway: summaries[c], steps
  }] };
});
if (index !== 15) throw new Error(`Expected 15 images; found ${index}`);
const tour = { version: 4, title: 'Bygone, one screen at a time', range: { base, head }, anchors, connections: [], chapters };
fs.writeFileSync(`${folder}/walkthrough.bygone`, JSON.stringify(tour, null, 2) + '\n');
