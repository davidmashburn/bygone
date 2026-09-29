# Codebase Guide

## Overview

Bygone is a change-understanding system with several hosts around one diff renderer:

- the standalone Electron explorer
- the standalone tour presenter
- the VS Code extension
- the browser presenter
- the CLI and agent-facing tour tools

The codebase was originally organized as three runtime halves:

1. The extension host side in [`src/`](./src)
2. The shared browser UI in [`media/`](./media)
3. The standalone Electron host in [`standalone/`](./standalone)

The host decides what to compare and computes structured diff data. The browser UI renders that data, manages the Monaco editors, and draws the connector geometry. The VS Code host and Electron host use the same bundled browser runtime through different host bridges. Change tours add a second host path: the CLI compiles a portable manifest, a local HTTP server serves it, and a dedicated desktop or browser presenter renders it.

## Product Surface Map

This section is the internal map of what Bygone exposes. It exists to prevent a shared renderer from being mistaken for one undifferentiated product surface.

Use these maturity labels consistently:

- **Core**: a primary user workflow that should be discoverable, documented, and protected by release checks.
- **Secondary**: supported, but not part of the shortest product explanation.
- **Advanced authoring**: intentionally explicit tooling for people or agents constructing a presentation.
- **Developer-only**: smoke, sample, capture, or debugging behavior that should not appear as a normal product command.
- **Experimental**: implemented and tested, but not yet supported by sufficient examples or usage guidance.

### Standalone explorer

The main Electron window is the primary interactive product. Its session model lives in [`standalone/main.js`](./standalone/main.js).

| Mode | User question | Primary entry | Revision model | Editing | Maturity |
| --- | --- | --- | --- | --- | --- |
| Blank diff | “I need scratch panes before I have files.” | `bygone --diff` outside a Git range | No revisions | Yes | Secondary |
| File diff | “How do these two concrete files differ?” | Two files, drag/drop, or **Compare Files** | Two supplied snapshots | Yes | Core |
| Multi-file diff | “How does this file vary across several snapshots?” | Three or more files or **Compare Multiple Files** | Ordered supplied snapshots | Yes | Secondary |
| Directory diff | “What differs between these directories?” | Two or more directories | Ordered directory snapshots | Drill-down files can be edited | Core for two directories; secondary for N directories |
| File history | “How did this file change over time?” | One file or `--history <file>` | Real commit/parent history plus optional staged/working state | Current-side edits are supported | Core |
| Directory history | “What changed in this area over time?” | No args in a Git repo, one directory, or `--history <directory>` | Real directory snapshots across history | Drill-down current-side edits are supported | Core |
| Git ref comparison | “How do these exact refs or work states differ?” | `--git-diff <ref1> <ref2> [...]` | Real refs, `INDEX`, and `WORKTREE` | Depends on source | Secondary; CLI-discovered |
| Branch review | “What is the committed branch delta from its merge base?” | `review` or **Review Current Branch** | Merge base to committed head | Read-only review snapshots | Secondary |

The argument-count shortcuts are convenient, but they are not the mental model. Documentation and UI copy should lead with the user question and name the resulting mode explicitly.

### Tour presenter

`bygone present` does not replace the main explorer session. It compiles a manifest, starts a loopback HTTP server, and opens a separate tour window. Treat it as a presentation product that reuses the renderer, not as another explorer mode.

| Scene type | What it represents | When to use it | When not to use it | Maturity |
| --- | --- | --- | --- | --- |
| Plain text diff | One complete file-level base/head comparison | Automatic tours and complete-file browsing | When authored narrative is needed | Core fallback |
| Walkthrough | A sequence of authored focus steps over the real base/head diff | Explaining a causal path through one or more changed files | Showing intermediate revisions or inventing a logical implementation order | Core authored form |
| Stacked diff | Three to six real Git refs shown as adjacent revisions | Explaining how code actually evolved across selected commits, tags, or branches | Explaining a squashed change whose logical stages never existed as refs | Experimental advanced authoring |
| Deconstructed diff | Synthetic cumulative stages assembled from hunks in one real base-to-target diff | Teaching a logical implementation order when real commit history is noisy, squashed, or absent | Claiming that the stages were commits or historical states | Experimental advanced authoring |

The terminology is important:

- A **stacked diff** contains real Git objects. Its labels and ordering make a historical claim.
- A **deconstructed diff** contains virtual explanation states. It does not reconstruct commits and must never be described as “deconstructed commits.”
- A **walkthrough** keeps the actual base/head endpoints and changes only the reader's focus.
- Explorer `--git-diff` and a tour `stacked-diff` can use similar refs, but they serve different jobs: open-ended inspection versus authored presentation.

Stacked and deconstructed scenes currently have schema, compiler, renderer, and unit-test support, but no checked-in source example. Until each has an end-to-end example and authoring guidance, keep both labeled experimental.

### Tour authoring and automation

These commands are tooling, not standalone viewing modes:

| Command | Audience | Contract |
| --- | --- | --- |
| `tour context` | Agents and authors | Emit bounded Git evidence without invoking a model |
| `tour validate` | Authors and CI | Resolve refs, anchors, scene structure, and advanced-stage assignments |
| `tour compile` | Hosts and artifact builders | Produce the portable manifest consumed by presenters |
| `tour coverage` | Authors and CI | Report which changed units the narrative references and at what declared depth |
| `tour schema` | Editors and agents | Publish the machine-readable source contract |

These commands should remain composable and non-interactive. Do not move their complexity into the desktop menus merely to make every capability visible.

### Companion hosts

- The **VS Code extension** should provide contextual file comparison and history, or hand off app-sized branch, directory, multi-panel, and tour work to the standalone app.
- The **browser presenter** is the portable tour host. It does not own filesystem mutation, Git discovery, or desktop session management.
- The **CLI** is the stable routing and automation boundary. Developer-only flags such as test, smoke, capture, and window sizing should not be marketed as product modes.

### Discoverability gaps

The implementation currently exposes more than the product explains:

- Tours can only be opened through the CLI; the desktop **File** menu cannot open a `.bygone.yaml` file.
- `--git-diff`, blank diff, and explicit tour authoring are CLI-only paths.
- The menu item **Compare File History…** accepts a directory and silently becomes directory history.
- **Compare Multiple Files…** accepts one file and silently becomes file history.
- **Compare Test Files** and **Toggle Developer Tools** are developer conveniences exposed in production menus.
- Branch review reports files as viewed, but the UI can still imply a stronger review/checklist meaning.
- Stacked and deconstructed scenes are advertised in the changelog but absent from the authoring guide and checked-in examples.

### Surface guardrails

Before adding a mode or scene type, answer all of these in the same change:

1. What user question does it answer that an existing mode does not?
2. Is it explorer behavior, presentation behavior, authoring tooling, or developer support?
3. Does it use real revisions, supplied snapshots, or synthetic states?
4. Is it editable, and which save/undo/reload lifecycle owns those edits?
5. How does a user discover it without reading source code?
6. Which walkthrough or example demonstrates its intended use?
7. Which host owns it, and which hosts should only hand off to it?
8. What maturity label does it carry until those requirements are satisfied?

If those answers are unclear, extend an existing mode rather than creating another entry path.

## Top-Level Layout

### `src/`

- [`extension.ts`](./src/extension.ts)
  Extension activation and command registration.

- [`fileComparator.ts`](./src/fileComparator.ts)
  Main orchestration layer for compare commands and history stepping.

- [`diffViewProvider.ts`](./src/diffViewProvider.ts)
  Owns the VS Code `WebviewViewProvider`, webview HTML, CSP, and message transport.

- [`diffEngine.ts`](./src/diffEngine.ts)
  Core diff logic. It also contains a retained internal merge helper that is not exposed as a product feature.

- [`gitHistory.ts`](./src/gitHistory.ts)
  Resolves file history from git and materializes commit-vs-parent diff inputs.

- [`sampleFiles.ts`](./src/sampleFiles.ts)
  Generates the built-in sample comparison files used by the test/demo command.

- [`fallbackViews.ts`](./src/fallbackViews.ts)
  Markdown fallback previews used when the custom webview is unavailable.

- [`webviewMessages.ts`](./src/webviewMessages.ts)
  Shared extension-host-side message contracts and inbound message guards.

- [`diff.d.ts`](./src/diff.d.ts)
  Local type declarations for the `diff` package.

### `media/`

- [`webview-entry.js`](./media/webview-entry.js)
  Browser bundle entrypoint. Imports Monaco, CSS, and the webview modules.

- [`script.js`](./media/script.js)
  Main webview app orchestration: Monaco setup, message handling, decorations, history toolbar, and scroll sync.

- [`dom.js`](./media/dom.js)
  Shared DOM and line-rendering helpers for the webview.

- [`connectors.js`](./media/connectors.js)
  Connector drawing engine. Owns gutter geometry and canvas rendering.

- [`editor.worker.entry.js`](./media/editor.worker.entry.js)
  Build entrypoint for the Monaco editor worker bundle.

- [`style.css`](./media/style.css)
  Base source styles for the webview.

- [`webview.js`](./media/webview.js)
  Bundled browser runtime generated by the build.

- [`webview.css`](./media/webview.css)
  Bundled browser CSS generated by the build.

- [`editor.worker.js`](./media/editor.worker.js)
  Bundled Monaco worker generated by the build.

- [`icon.png`](./media/icon.png)
  Extension icon used for packaging/listing.

- [`bygone-screenshot.png`](./media/bygone-screenshot.png)
  README screenshot.

### `scripts/`

- [`build.mjs`](./scripts/build.mjs)
  Build pipeline using `esbuild` for both extension-host and webview assets.

- [`bygone-difftool.sh`](./scripts/bygone-difftool.sh)
  Shell wrapper for `git difftool` that launches Bygone via VS Code URI handling.

- [`configure-git-difftool.sh`](./scripts/configure-git-difftool.sh)
  Convenience script that registers the VS Code URI launcher as a git difftool.

- [`bygone-standalone-difftool.sh`](./scripts/bygone-standalone-difftool.sh)
  Shell wrapper for `git difftool` that launches the standalone Bygone app.

- [`configure-git-difftool-standalone.sh`](./scripts/configure-git-difftool-standalone.sh)
  Convenience script that registers the standalone launcher as a git difftool.

### `standalone/`

- [`main.js`](./standalone/main.js)
  Electron main process. Owns menus, CLI launch parsing, file I/O, git history loading, save/reload, watch prompts, and bridge messages into the shared UI.

- [`preload.js`](./standalone/preload.js)
  Electron preload bridge. Exposes the same browser-host contract that the VS Code webview uses.

- [`index.html`](./standalone/index.html)
  Standalone window shell that mounts the same shared bundled UI used by the extension.

### `cli/`

- [`commandSpec.js`](./cli/commandSpec.js)
  Shared CLI vocabulary used by help, parsing, and shell completion.

- [`present.js`](./cli/present.js)
  Compiles a branch range or authored tour, serves the portable manifest on loopback HTTP, and launches the presenter.

- [`tour.js`](./cli/tour.js)
  Non-interactive validation, compilation, context, coverage, and schema commands for authors, agents, and CI.

### `web/`

- [`index.html`](./web/index.html)
  Browser presenter shell for compiled change-tour manifests.

- [`host.js`](./web/host.js)
  Source host bridge for browser presentation and file selection.

- [`presenter.css`](./web/presenter.css)
  Tour rail and presenter-specific layout layered around the shared renderer.

### Change-tour domain code

- [`changeTour.ts`](./src/changeTour.ts)
  Builds automatic manifests and compiles walkthrough, stacked, and deconstructed authored scenes.

- [`changeTourSource.ts`](./src/changeTourSource.ts)
  Validates the human-authored YAML model.

- [`changeTourManifest.ts`](./src/changeTourManifest.ts)
  Defines and validates the portable host-independent manifest.

- [`deconstructedChange.ts`](./src/deconstructedChange.ts)
  Builds synthetic cumulative explanation stages from owned change hunks.

- [`changeTourContext.ts`](./src/changeTourContext.ts), [`changeInventory.ts`](./src/changeInventory.ts), and [`tourCoverage.ts`](./src/tourCoverage.ts)
  Produce bounded authoring evidence, stable change units, and coverage reports.

### `test/`

- [`runTests.js`](./test/runTests.js)
  Logic and contract checks spanning diff behavior, Git ranges and history, CLI parsing, desktop session helpers, change-tour compilation, advanced scene types, coverage, packaging, and retained internal merge behavior.

## Runtime Architecture

### 1. Activation

[`extension.ts`](./src/extension.ts) activates the extension by:

- creating a `FileComparator`
- creating a `DiffViewProvider`
- wiring the provider into the comparator
- registering all user commands
- registering the `WebviewViewProvider`
- registering a VS Code URI handler for external launches

This file is intentionally thin. It should stay that way.

### 2. Command Orchestration

[`fileComparator.ts`](./src/fileComparator.ts) is the main application controller.

Its responsibilities are:

- selecting files from the workspace
- reading file contents
- calling the diff engine
- dispatching results to the webview provider
- generating sample files
- managing current file-history state and back/forward navigation
- delegating git history resolution to `GitHistoryService`

It should not own rendering details or raw webview message parsing.

### 3. Structured Diff Model

[`diffEngine.ts`](./src/diffEngine.ts) is the core logic layer.

For two-way diffs it produces a `TwoWayDiffModel` with:

- `rows`
  Aligned left/right rows, including placeholders for insert/delete alignment.

- `leftLines` and `rightLines`
  Rendered lines for each pane, including optional inline segments for replace hunks.

- `blocks`
  Higher-level diff hunks used for connector rendering and line-level highlighting.

- `hasChanges`
  Summary bit for quick checks.

The two-way model is used in two different ways:

- the extension host sends it to the webview
- the webview uses `rows` for scroll anchoring and `blocks` for geometry/highlighting

`diffEngine.ts` still contains `mergeText()` from an earlier experiment. Bygone does not expose merge UI or CLI surfaces; the product is intentionally diff-focused.

### 4. Webview Transport

[`diffViewProvider.ts`](./src/diffViewProvider.ts) is the extension-host/webview boundary.

It handles:

- lazy reveal of the custom sidebar view
- initial webview HTML generation
- CSP and resource URIs
- queueing messages until the webview signals `ready`
- message reception from the webview
- recomputing diffs after live editor changes

The message contracts are typed in [`webviewMessages.ts`](./src/webviewMessages.ts). The webview HTML now injects a small host bridge object so the shared renderer can run without directly depending on `acquireVsCodeApi()`.

Outbound message types:

- `showDiff`
- `showDirectoryDiff`
- `showMultiDiff`

Inbound message types:

- `ready`
- `recomputeDiff`
- `historyBack`
- `historyForward`

There is also an external launch path through [`uriHandler.ts`](./src/uriHandler.ts), which accepts:

```text
vscode://davidmashburn.bygone/diff?left=...&right=...
```

That path is what the VS Code git difftool wrapper uses.

### 5. Webview Runtime

The shared browser runtime is bundled from [`webview-entry.js`](./media/webview-entry.js).

That bundle:

- imports Monaco ESM APIs
- imports the DOM helper module
- imports the connector module
- imports the main orchestration module
- exposes `window.monaco` for the rest of the app

The main orchestration code lives in [`script.js`](./media/script.js).

Its responsibilities are:

- receiving `showDiff`, `showDirectoryDiff`, and `showMultiDiff`
- initializing Monaco
- creating the two editable editors
- creating read-only adjacent multi-panel editors
- applying Monaco decorations from the diff model
- sending debounced `recomputeDiff` messages back to the active host
- maintaining diff-row-based synchronized scrolling
- driving the history toolbar

The key design choice here is that scrolling is not purely proportional. It maps through the aligned diff rows so insert/delete blocks anchor correctly.

The renderer talks to a generic `window.__BYGONE_HOST__` bridge when present, and falls back to a VS Code bridge if it is running inside the extension webview.

### 6. Connector Rendering

[`connectors.js`](./media/connectors.js) owns the custom visual geometry.

It builds a controller that:

- initializes the canvas layer
- resizes the canvas with the layout
- schedules draw work with `requestAnimationFrame`
- computes block bounds from Monaco line metrics
- draws replace and one-sided connector shapes
- applies filled regions and contour lines

This module is intentionally separate because it is the most geometry-heavy and easiest part to destabilize if mixed back into the main webview logic.

### 7. DOM/Static Rendering Helpers

[`dom.js`](./media/dom.js) owns small DOM helpers and simple non-Monaco line rendering helpers retained for internal/unwired views.

This includes:

- element lookup helpers
- toolbar clearing
- plain line rendering
- simple line rendering helpers
- simple view toggling
- status banner handling

Keeping this separate prevents `script.js` from devolving into a wall of `document.getElementById(...)`.

## File History Flow

Git history support is centered around [`gitHistory.ts`](./src/gitHistory.ts).

`GitHistoryService.buildFileHistory()`:

1. finds the repo root
2. resolves the file path relative to that repo
3. runs `git log --follow` for that file
4. resolves each commit’s primary parent
5. loads file contents for `parent:file` and `commit:file`
6. returns a list of `FileHistoryEntry` objects

The history viewer is intentionally simple:

- one file at a time
- single-parent stepping
- commit vs direct parent

It is not yet trying to model merge commits or working tree vs `HEAD`.

## Build Pipeline

The build entrypoint is [`build.mjs`](./scripts/build.mjs).

Current outputs:

- bundled extension host: [`out/extension.js`](./out/extension.js)
- test target: [`out/diffEngine.js`](./out/diffEngine.js)
- bundled webview runtime: [`media/webview.js`](./media/webview.js)
- bundled webview CSS: [`media/webview.css`](./media/webview.css)
- bundled Monaco worker: [`media/editor.worker.js`](./media/editor.worker.js)

Build steps:

1. typecheck with `tsc --noEmit`
2. bundle extension host with `esbuild`
3. bundle test-target diff engine with `esbuild`
4. bundle webview runtime with `esbuild`
5. bundle Monaco worker with `esbuild`

The build also clears old outputs first so stale files do not leak into packaging.

## Packaging

Packaging is driven by:

- [`package.json`](./package.json)
- [`.vscodeignore`](./.vscodeignore)

Generated source maps, `node_modules`, TypeScript sources, raw webview modules, and desktop sources are excluded from the VSIX. The current ignore-list approach is still permissive: the extension package also picks up tour sources, browser-presenter files, CLI helpers, shell completions, mockups, Homebrew templates, and internal documentation that the extension does not call. Treat that as packaging-boundary drift rather than intentional extension functionality.

When the extension surface is narrowed, prefer an explicit extension file allowlist or add a package-content assertion. Sharing source code across hosts does not require distributing every host's documentation and tooling in every artifact.

## Test Strategy

[`runTests.js`](./test/runTests.js) is broad but still primarily logic-focused.

It currently validates:

- diff alignment, matching, highlighting, and performance boundaries
- Git history, range, rename, directory, and binary behavior
- CLI launch parsing, completion generation, and selected desktop session helpers
- tour source, manifest, context, inventory, coverage, walkthrough, stacked, and deconstructed contracts
- package, release, and privacy assertions
- narrow checks for the retained internal merge helper

What it does not cover yet:

- command registration behavior
- webview startup behavior
- Monaco/editor integration
- full Git and filesystem integration across every launch mode

So current tests protect model and contract layers well, but not the full Electron, VS Code, or browser interaction lifecycle.

## Important Design Decisions

### Webview Instead of Native Diff Editor

This codebase deliberately uses a custom webview because the product requires:

- custom connectors
- custom within-line styling
- symmetric dual-pane editing
- custom history navigation UI

That is much easier to implement in a controlled webview than by trying to force the built-in VS Code diff editor to behave like Meld.

### Separate Diff Model and Render Model

The extension host computes a structured diff model first, then the webview renders from it.

That separation is what makes:

- history stepping
- live recomputation
- connector drawing
- line decorations
- scroll synchronization

work coherently without the UI reparsing plain text diffs.

### Bundled Webview Assets

The webview was moved away from Monaco’s shipped AMD runtime tree and into bundled assets. This reduced the VSIX from a large multi-thousand-file package to a much smaller release artifact and removed the `vsce` file-count warning.

## Current Weak Spots

### 1. Directory compare depth

Directory compare now classifies modified files and can drill down into file diffs, including adjacent multi-panel diffs from three-directory comparisons. Deep tree ergonomics and richer filtering are still early.

### 2. Webview size

The file-count warning is gone, but [`webview.js`](./media/webview.js) is still large because Monaco is bundled into it. That is acceptable for now, but still the single largest runtime asset.

### 3. Limited integration testing

The code is much cleaner now, but runtime confidence still depends heavily on manual testing in VS Code.

## Maintenance Guidance

If you need to change the code:

- change compare/history orchestration in [`fileComparator.ts`](./src/fileComparator.ts)
- change core diff semantics in [`diffEngine.ts`](./src/diffEngine.ts)
- change webview lifecycle or CSP in [`diffViewProvider.ts`](./src/diffViewProvider.ts)
- change webview app behavior in [`script.js`](./media/script.js)
- change connector visuals in [`connectors.js`](./media/connectors.js)
- change simple DOM rendering/helpers in [`dom.js`](./media/dom.js)
- change git-history resolution in [`gitHistory.ts`](./src/gitHistory.ts)
- change package outputs in [`build.mjs`](./scripts/build.mjs)

Good rule:

- keep orchestration in orchestration files
- keep rendering in rendering files
- keep git shell logic out of UI/control code
- keep message contracts centralized

## Recommended Next Steps

If this codebase keeps growing, the best next improvements are:

1. Add extension-host integration tests for command and provider flows.
2. Add filtering, search, and collapse-state persistence to directory compare.
3. Add working-tree vs `HEAD` support to file history.
4. Add release automation for build, package, and smoke validation.
