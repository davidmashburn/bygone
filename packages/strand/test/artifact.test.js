const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { correspondenceFixture } = require('../../../test/correspondenceFixture');
const { analyzeGit } = require('../../../scripts/change-analysis/analyze-git');
const { loadChangeCorrespondence } = require('../../../out/changeCorrespondence');

const examples = [
    ['go', 'go', 'package tally\nfunc price(x int) int { return x * 9 + 1 }\n'],
    ['rust', 'rs', '#[inline]\npub fn price(x: i32) -> i32 { x * 9 + 1 }\n'],
    ['mojo', '🔥', 'def price(x: Int) -> Int:\n    return x * 9 + 1\n']
];
for (const [language, extension, source] of examples) {
    test(`${language} artifacts validate against committed sources after worktree edits`, () => {
        const before = '// 😀\r\n' + source;
        // Mojo uses Python-style comments; retain non-ASCII offsets in each input.
        const original = language === 'mojo' ? before.replace('//', '#') : before;
        const next = original.replace('price(', 'cost(').replace('+ 1', '+ 2');
        const filename = `new.${extension}`;
        const fixture = correspondenceFixture({ before: { [`old.${extension}`]: original }, after: { [filename]: next } });
        try {
            fs.writeFileSync(path.join(fixture.root, filename), 'dirty working copy');
            const output = path.join(fixture.root, 'analysis.json');
            const artifact = analyzeGit(['--base', fixture.range.baseOid, '--output', output, '--engine', 'bygone-strand'],
                fixture.root, { write() {} }, {});
            assert.deepEqual(loadChangeCorrespondence(fixture.root, output, fixture.range), artifact);
            assert.equal(artifact.status, 'complete');
            assert.equal(artifact.relations.length, 1);
            assert.equal(artifact.relations[0].rawEqual, false);
            assert(artifact.limitations.some(line => line.includes(`${language}@`)));
            if (language === 'mojo') assert(artifact.limitations.some(line => line.includes('Mojo is experimental')));
            assert(!JSON.stringify(artifact).includes('strandFeatures'));
        } finally { fixture.dispose(); }
    });
}
