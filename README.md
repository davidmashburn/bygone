# Melden

Melden is a VS Code extension and standalone desktop app for side-by-side comparison with a custom Meld-style diff view.

![Melden screenshot](./media/melden-screenshot.png)

## Features

- Editable two-way side-by-side diff view
- Meld-style connectors, block contours, and inline change highlighting
- Git file history viewer with commit-by-commit navigation
- Experimental three-way merge visualization

## Status

This project is usable as a local or private pre-release VS Code extension. The two-way diff and git history flows are the most complete. Three-way merge is still experimental and should not be treated as an apply-safe merge tool.

## Install For Development

Install dependencies and compile:

```bash
npm install
npm run compile
```

Run the extension in VS Code:

1. Open this folder in VS Code.
2. Press `F5`.
3. In the Extension Development Host, run one of the Melden commands from the Command Palette.

Run the standalone desktop app locally:

```bash
npm run standalone:start
```

Run a headless standalone smoke check:

```bash
npm run standalone:smoke
```

Or install the standalone launcher globally:

```bash
npm install -g .
melden --diff path/to/left path/to/right
melden --help
```

## Package For External Use

This repo is set up for local/private packaging. A typical release flow is:

```bash
npm install
npm test
npx @vscode/vsce package
```

That produces a `.vsix` you can install with `Extensions: Install from VSIX...`.

Build the standalone desktop packages:

```bash
npm install
npm run package:desktop
```

That produces desktop artifacts for macOS, Windows, and Linux AppImage in `dist/`.

In the standalone window, you can also drag and drop:

- 1 file to open git history for that file
- 2 files to open a side-by-side diff
- 3 files to open the experimental three-way merge view

## Git Difftool

Melden can be launched from `git difftool` through either the standalone app or the VS Code extension.

Configure the standalone launcher:

```bash
./scripts/configure-git-difftool-standalone.sh
```

That registers:

```text
git difftool -t melden
```

Configure the VS Code launcher:

```bash
./scripts/configure-git-difftool.sh
```

That registers:

```text
git difftool -t melden-vscode
```

The VS Code path launches:

```text
vscode://davidmashburn.melden/diff?left=...&right=...
```

The wrapper scripts are:

```bash
./scripts/melden-difftool.sh <left-file> <right-file>
./scripts/melden-standalone-difftool.sh <left-file> <right-file>
```

## Commands

- `Melden: Compare Files`
- `Melden: Compare with Selected`
- `Melden: Three Way Merge (Experimental)`
- `Melden: Compare Test Files`
- `Melden: Compare File History`
- `Melden: Compare Active File History`

## Limitations

- Three-way merge is not a full `diff3` implementation.
- Merge results are visualized only; they are not written back to disk.
- The git history viewer currently steps through single-parent commit history for one file at a time.
- Marketplace publishing metadata is not finalized yet.

## Release Work

The current release checklist and remaining publication blockers are tracked in [RELEASE_PLAN.md](./RELEASE_PLAN.md).

## Codebase Guide

Architecture and implementation details are documented in [CODEBASE.md](./CODEBASE.md).

## Tests

Run the current unit checks with:

```bash
npm test
```
