# Diff regression coverage

Run `npm test` for the engine, mapping, and host tests. Run
`npm run test:diff-renderer` for the real Electron/Monaco rendering and scroll
checks; these also run in `npm run standalone:smoke` on macOS CI.

`yamlDiffFixture.js` generates an original, synthetic tour-shaped document with
long unchanged surroundings, repeated YAML keys, indentation changes, wrapped
paragraphs, an insertion, and a substantive edit. It contains no private review
material. `diffRegression.test.js` checks both comparison directions, exact
whitespace highlight columns, word replacement edge trimming (including its
contiguous-middle limit and whole-character Unicode boundaries) on bare identifiers
and code statements, expected reflow boundaries, preservation of all
source lines and segment text, line-length limits, newline variants, and scroll
correspondence before, within, and after changes. Edited one-to-many paragraphs
keep inline changes and exclude neighboring additions/deletions; touching blue
regions merge without merging their scroll anchors. Touching opposite green blocks form a blue replacement;
unrelated multiline changes retain conservative row alignment. Prefix scoring is tested
without neighboring anchors, across repeated scenes, against ambiguous repeated
labels and boilerplate, and against unrelated long values.

`standalone/diffRegressionSmoke.js` checks actual painted whitespace, Monaco
ranges, worker-computed diffs, two/three-panel scrolling, wrapping, and panel
switching, and canvas pixels clipped to the editor bounds. It uses an isolated window rather than the installed desktop session.
Monaco must measure wrapped lines before assertions use their pixel geometry.

The approach draws on [Meld's exact text-tag range tests](https://github.com/GNOME/meld/blob/main/test/test_filediff.py)
and [matching-block tests](https://github.com/GNOME/meld/blob/main/test/test_matchers.py),
and [VS Code's reviewed diff fixtures](https://github.com/microsoft/vscode/blob/main/src/vs/editor/test/node/diffing/README.md).
Expected ranges are deliberately authored and reviewed; do not regenerate them
from the implementation to make a failure pass.

# Panel density coverage

`focusedStrip.test.js` covers the 2/3/4/Fit width boundaries, minimum movement,
uncapped Fit with five or more panels, end clamping, short scenes, and optional preference storage.
`standalone/panelDensitySmoke.js`, run by `test:diff-renderer`, exercises real
Monaco resizing, visible versus comparison-wide Find, stable models and
selections, edits and undo, wrapped scroll anchors, connector endpoints,
shorter scenes, and panel removal. The workspace smoke separately covers
forward, backward, interrupted, and immediate strip transitions.

# Tour presentation coverage

After compilation, run `node scripts/run-electron.mjs standalone/exportSmoke.js`
for offline exports, section navigation, and desktop links to tours outside their
repository. The live fixture also checks sticky scene headings, step-link
placement below the heading, pointer and keyboard overview toggles without
scrolling or changing steps, bounded overview height, and scene transitions in
both directions that close the previous overview.

The workspace history tests cover changed-file navigation across displayed
revisions, including empty trees, renames, deletions, and staged/working copies.
Unchanged files remain selectable from Files. The native workspace smoke checks
Files beside Commits, controls above the left navigator, and scene-title
expansion without changing the active passage or code evidence.
