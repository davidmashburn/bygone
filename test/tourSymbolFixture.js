const fs = require('node:fs');
const path = require('node:path');
const { correspondenceFixture } = require('./correspondenceFixture');
const { correspondenceTreeFixture } = require('./correspondenceTreeFixture');

function tourSymbolFixture() {
    const input = correspondenceTreeFixture(), repo = correspondenceFixture(input);
    input.artifact.range = repo.range;
    fs.writeFileSync(path.join(repo.root, 'symbols.json'), JSON.stringify(input.artifact));
    const source = { version: 6, title: 'Follow a moved declaration', range: { base: repo.range.baseOid, head: repo.range.headOid },
        correspondence: 'symbols.json', anchors: { moved: { file: 'src/moved.py', revision: 'head', contains: 'def transfer()' } }, connections: [],
        chapters: [{ id: 'move', title: 'Declaration evidence', scenes: [{ id: 'move', kind: 'walkthrough', title: 'Follow the declaration',
            summary: 'A declaration moves between files.', bullets: [], tags: [], takeaway: 'Compare both pinned declarations.',
            steps: [{ id: 'transfer', title: 'Read the moved declaration', body: 'The accepted mapping links the two locations; behavior remains unassessed.', focus: 'moved', symbol: { relation: 'relation-transfer' } }] }] }] };
    return { ...repo, input, source };
}
module.exports = { tourSymbolFixture };
