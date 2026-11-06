const fs = require('node:fs');
const { exportFixture } = require('./exportFixture');

function optionalBranchesFixture() {
    const fixture = exportFixture({ nestedFiles: true });
    const source = fixture.source;
    source.version = 7;
    source.title = 'Review the change at your own depth';
    source.anchors.detail = { file: 'nested/deep/late.txt', revision: 'head', contains: 'added' };
    const scene = source.chapters[0].scenes[0];
    scene.title = 'A concise main path';
    scene.summary = 'Read the outcome, inspect an explanation if needed, then continue.';
    scene.takeaway = 'Optional evidence stays available without extending the main argument.';
    scene.steps = [
        { id: 'outcome', title: 'The changed value is explicit', body: 'The main path states the result. Its explanation and exact evidence are available below.', focus: 'changed', branches: [
            { id: 'why', title: 'Why does this change matter?', steps: [
                { id: 'reason', title: 'Callers observe the new value', body: 'This explanation adds the consequence without repeating the main claim.', focus: 'changed', branches: [
                    { id: 'evidence', title: 'What evidence supports this?', steps: [
                        { id: 'proof', title: 'Additional evidence is packaged', body: 'The optional-evidence-marker makes this explanation searchable. The code pane shows a file used only by this branch.', focus: 'detail' }
                    ] }
                ] },
                { id: 'qualification', title: 'The scope remains bounded', body: 'This second explanation step is on the same optional path.', focus: 'changed' }
            ] }
        ] },
        { id: 'boundary', title: 'The next main claim stays close', body: 'Continue here after the first claim without passing through optional detail.', focus: 'changed' },
        { id: 'finish', title: 'The main path is complete', body: 'Readers can stop here or return to an earlier question.', focus: 'changed' }
    ];
    delete source.tours;
    source.opening = { title: 'Three claims, optional evidence', summary: 'Understand the change first; inspect supporting detail when it is useful.' };
    source.conclusion = { title: 'Ready to review', summary: 'The main path has covered the outcome and its boundaries.' };
    fs.writeFileSync(fixture.sourcePath, JSON.stringify(source));
    return fixture;
}

module.exports = { optionalBranchesFixture };
