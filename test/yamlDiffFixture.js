// Synthetic tour-shaped YAML: repeated keys, long prose, physical reflow,
// reindentation, an insertion, a real edit, and long unchanged surroundings.
// Keep customer documents out of fixtures.
function yamlDiffFixture() {
    const before = Array.from({ length: 160 }, (_, index) => `# Unchanged context ${index}`);
    before.push('chapters:');
    const after = [...before];
    const reflows = [];
    for (let index = 0; index < 40; index++) {
        before.push(`  - id: section-${index}`, '    kind: note');
        after.push(`    - id: section-${index}`, '      kind: note');
        const words = (`body: Section ${index} explains the comparison. `
            + 'Follow the source evidence and verify each step before proceeding. '.repeat(12)).trim().split(' ');
        const leftStart = before.length;
        const rightStart = after.length;
        before.push(`    ${words.join(' ')}`);
        let line = '      ';
        for (const word of words) {
            if (line.trim() && line.length + word.length + 1 > 86) {
                after.push(line);
                line = '        ';
            }
            line += `${line.trim() ? ' ' : ''}${word}`;
        }
        after.push(line);
        reflows.push({ kind: 'replace', leftStart, leftEnd: before.length, rightStart, rightEnd: after.length, reflow: true });
        before.push(`    status: ${index === 20 ? 'pending' : 'ready'}`, '    tags: [review, evidence]');
        after.push(`      status: ${index === 20 ? 'completed' : 'ready'}`, '      tags: [review, evidence]');
        if (index === 10) after.push('    - id: new-section', '      body: Newly added guidance.');
    }
    const suffixStart = { left: before.length, right: after.length };
    const suffix = Array.from({ length: 100 }, (_, index) => `# Unchanged footer ${index}`);
    before.push(...suffix);
    after.push(...suffix);
    return { before, after, reflows, suffixStart };
}

module.exports = { yamlDiffFixture };
