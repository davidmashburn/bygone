# Diff regression coverage

Run `npm test` for the engine, mapping, and host tests. Run
`npm run test:diff-renderer` for the real Electron/Monaco rendering and scroll
checks; these also run in `npm run standalone:smoke` on macOS CI.

`yamlDiffFixture.js` generates an original, synthetic tour-shaped document with
long unchanged surroundings, repeated YAML keys, indentation changes, wrapped
paragraphs, an insertion, and a substantive edit. It contains no private review
material. `diffRegression.test.js` checks both comparison directions, exact
whitespace highlight columns, expected reflow boundaries, preservation of all
source lines and segment text, line-length limits, newline variants, and scroll
correspondence before, within, and after changes.

`standalone/diffRegressionSmoke.js` checks actual painted whitespace, Monaco
ranges, worker-computed diffs, two/three-panel scrolling, wrapping, and panel
switching. It uses an isolated window rather than the installed desktop session.
Monaco must measure wrapped lines before assertions use their pixel geometry.

The approach draws on [Meld's exact text-tag range tests](https://github.com/GNOME/meld/blob/main/test/test_filediff.py)
and [matching-block tests](https://github.com/GNOME/meld/blob/main/test/test_matchers.py),
and [VS Code's reviewed diff fixtures](https://github.com/microsoft/vscode/blob/main/src/vs/editor/test/node/diffing/README.md).
Expected ranges are deliberately authored and reviewed; do not regenerate them
from the implementation to make a failure pass.
