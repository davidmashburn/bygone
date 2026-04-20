# Bygone

Bygone is a VS Code extension and standalone desktop app for visual diff and file history.

![Bygone screenshot](./media/bygone-screenshot.png)

## Features

- Editable two-way side-by-side diff view
- Prototype three-file adjacent diff view
- Flowing connectors, block contours, and inline change highlighting
- Git file history viewer with commit-by-commit navigation

## Status

This project is usable as a local or private pre-release VS Code extension. The two-way diff and git history flows are the most complete. The three-file view is a diff-focused N-panel prototype, not a merge tool.

## Migration Note

This project was renamed from `Melden` to `Bygone`.

- VS Code extension id changed from `davidmashburn.melden` to `davidmashburn.bygone`
- CLI changed from `melden` to `bygone`
- Git difftool names changed from `melden` / `melden-vscode` to `bygone` / `bygone-vscode`
- Existing users should reinstall the extension and re-run the difftool setup scripts

## Install For Development

Install dependencies and compile:

```bash
npm install
npm run compile
```

Run the extension in VS Code:

1. Open this folder in VS Code.
2. Press `F5`.
3. In the Extension Development Host, run one of the Bygone commands from the Command Palette.

Run the standalone desktop app locally:

```bash
npm run standalone:start
```

Run a headless standalone smoke check:

```bash
npm run standalone:smoke
```

For development only, you can install the repo-local launcher globally:

```bash
npm install -g .
bygone --diff path/to/left path/to/right
bygone --help
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

That produces a macOS DMG in `dist/`. Cross-target packaging is split out because Windows and Linux builds may need additional Electron downloads or Wine support:

```bash
npm run package:desktop:mac:zip
npm run package:desktop:linux
npm run package:desktop:win
npm run package:desktop:all
```

Stage the scoped npm standalone package:

```bash
npm install
npm run package:npm
npm pack --dry-run ./dist/npm-package
```

The root `package.json` is the VS Code extension manifest and intentionally keeps the unscoped extension name `bygone`. The npm distribution is staged separately as `@davidmashburn/bygone` so the global launcher can avoid the already-taken `bygone` package name while preserving the VS Code extension id `davidmashburn.bygone`.

Run the release checks:

```bash
npm run release:check
npm run standalone:smoke
```

The standalone smoke check is intentionally run directly because Electron can abort on macOS when launched from a longer nested npm command chain, while the same smoke check passes as a direct release gate.

In the standalone window, you can also drag and drop:

- 1 file to open git history for that file
- 2 files or directories to open a side-by-side compare
- 3 files or directories to open a prototype three-panel compare

## Git Difftool

Bygone can be launched from `git difftool` through either the standalone app or the VS Code extension.

Configure the standalone launcher:

```bash
./scripts/configure-git-difftool-standalone.sh
```

That registers:

```text
git difftool -t bygone
```

Configure the VS Code launcher:

```bash
./scripts/configure-git-difftool.sh
```

That registers:

```text
git difftool -t bygone-vscode
```

The VS Code path launches:

```text
vscode://davidmashburn.bygone/diff?left=...&right=...
```

The wrapper scripts are:

```bash
./scripts/bygone-difftool.sh <left-file> <right-file>
./scripts/bygone-standalone-difftool.sh <left-file> <right-file>
```

## Commands

- `Bygone: Compare Files`
- `Bygone: Compare Directories`
- `Bygone: Compare Three Directories (Prototype)`
- `Bygone: Compare Three Files (Prototype)`
- `Bygone: Compare with Selected`
- `Bygone: Compare Test Files`
- `Bygone: Compare File History`
- `Bygone: Compare Active File History`

## Limitations

- Bygone is intentionally diff-focused; merge tooling is not exposed as a product feature.
- Directory compare supports modified-file detection and file drill-down; deep tree ergonomics are still early.
- The git history viewer currently steps through single-parent commit history for one file at a time.
- Marketplace publishing metadata is not finalized yet.

## Release Work

The current release checklist and remaining publication blockers are tracked in [RELEASE_PLAN.md](./RELEASE_PLAN.md).

## Codebase Guide

Architecture and implementation details are documented in [CODEBASE.md](./CODEBASE.md).

## Why “Bygone”?

**In short: this project is openly inspired by Meld, and Bygone is meant to carry that visual tradition into a more history-aware tool.**

Meld was a direct inspiration for this project. Its visual diff metaphor is still one of the clearest and most human ways to understand change, and Bygone builds on that lineage while pushing further into revision history.

The name also nods to the bygone era before vibe-coding, when people were at least pretending to read, understand, and take responsibility for the code they were writing. This tool is about looking directly at what changed, where it came from, and how the current state emerged.

And yes, Codex, the irony is noted. Thanks for the assist.

## Tests

Run the current unit checks with:

```bash
npm test
```
