# Melden

Melden is a VS Code extension prototype for side-by-side file comparison with a custom diff view.

![Melden screenshot](./media/melden-screenshot.png)

## Current status

- Two-way comparison is implemented and wired through a custom webview.
- The webview renders structured diff rows instead of reparsing a text diff.
- Three-way merge remains experimental and intentionally surfaces conflicts conservatively.

## Development

Install dependencies and compile:

```bash
npm install
npm run compile
```

Run the extension in VS Code:

1. Open this folder in VS Code.
2. Press `F5`.
3. In the Extension Development Host, run `Melden: Compare Files` or `Melden: Compare with Selected`.

## Commands

- `Melden: Compare Files`
- `Melden: Compare with Selected`
- `Melden: Three Way Merge (Experimental)`
- `Melden: Compare Test Files`

## Limitations

- Three-way merge is not a full diff3 implementation.
- The extension does not yet write merge results back to disk.
- There is no packaging or publishing automation beyond the helper shell scripts in this repo.

## Tests

Run the current unit checks with:

```bash
npm test
```
