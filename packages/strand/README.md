# Bygone Strand

A private, reusable Node package for bounded source declaration correspondence.
It takes path-to-source snapshot maps. It does not read Git, load Bygone artifacts,
render a UI, or require Java. Publishing is deliberately disabled.

```js
const { inventorySnapshot, matchStrand } = require('bygone-strand');
const before = { 'old.js': 'function total(rows) { return rows.length + 1; }' };
const after = { 'new.js': 'function count(rows) { return rows.length + 2; }' };
const inventories = {
    before: inventorySnapshot(before, 'before', { strandFeatures: true }),
    after: inventorySnapshot(after, 'after', { strandFeatures: true })
};
const evidence = matchStrand(before, after, inventories);
```

`inventorySnapshot(files, side, options)` returns exact UTF-16, half-open ranges,
source digests, parser diagnostics, and syntax exclusions. Python currently uses
an isolated CPython subprocess (`python3` or `options.python`).
`matchStrand(before, after, inventories, limits)` returns one-to-one candidate
mappers, ambiguous groups, rejection diagnostics, processed paths and status.
Its output is evidence, not proof of behavior preservation or a validated Bygone
artifact. The caller must validate endpoints against the supplied source.

JS/TS and Python implementations are preserved behind the package boundary.
Python stubs have inventory/exact coverage only. Candidate, token, output and
wall-clock budgets remain finite. No binding or type resolution, extract/inline,
or cross-language matches are claimed. The legacy analysis script entry points
remain compatible. Run `npm run test:strand` from the repository root.
