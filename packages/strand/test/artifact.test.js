const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { correspondenceFixture } = require('../../../test/correspondenceFixture');
const { analyzeGit } = require('../../../scripts/change-analysis/analyze-git');
const { loadChangeCorrespondence } = require('../../../out/changeCorrespondence');

const examples = [
    ['c', 'c', 'int price(int x) { return x * 9 + 1; }\n'],
    ['lua', 'lua', 'function price(x) return x * 9 + 1 end\n'],
    ['csharp', 'cs', 'namespace Shop;\nclass Cart { int price(int x) { return x * 9 + 1; } }\n', 3],
    ['ruby', 'rb', 'def price(x)\n x * 9 + 1\nend\n'],
    ['php', 'php', '<?php namespace Shop;\nfunction price($x) { return $x * 9 + 1; }\n', 2],
    ['go', 'go', 'package tally\nfunc price(x int) int { return x * 9 + 1 }\n'],
    ['rust', 'rs', '#[inline]\npub fn price(x: i32) -> i32 { x * 9 + 1 }\n'],
    ['mojo', '🔥', 'def price(x: Int) -> Int:\n    return x * 9 + 1\n']
];
for (const [language, extension, source, expectedRelations = 1] of examples) {
    test(`${language} artifacts validate against committed sources after worktree edits`, () => {
        const before = '// 😀\r\n' + source;
        // Mojo uses Python-style comments; retain non-ASCII offsets in each input.
        const original = ['mojo', 'ruby'].includes(language) ? before.replace('//', '#')
            : language === 'lua' ? before.replace('//', '--')
                : language === 'php' ? source.replace('<?php ', '<?php // 😀\r\n') : before;
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
            assert.equal(artifact.relations.length, expectedRelations);
            assert(artifact.relations.some(relation => !relation.rawEqual));
            assert(artifact.limitations.some(line => line.includes(`${language}@`)));
            if (language === 'mojo') assert(artifact.limitations.some(line => line.includes('Mojo is experimental')));
            assert(!JSON.stringify(artifact).includes('strandFeatures'));
        } finally { fixture.dispose(); }
    });
}
