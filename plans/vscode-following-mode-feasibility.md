# VS Code following mode: Lima feasibility

Tested 2026-10-23. Outcome: **proceed with the bounded first slice** in
[the scope](vscode-following-mode.md). High confidence that this VM can support
implementation and automated Extension Host testing. The prototype establishes
the integration seams; it is not the finished feature.

This is a historical test record. Following mode subsequently landed in `main`
at `ec318cfbd9d9cddef2fcac150723958c0f7987c2`; see the current
[scope status](vscode-following-mode.md) and
[SCM/symbol follow-up](vscode-scm-symbol-integration.md). Local harness and log
paths below describe the original environment, not files shipped in the repository.

## Environment and isolation

Used the existing `agent-prototype` Lima VM: Ubuntu ARM64, 4 CPUs, 8 GiB RAM.
Cloned Bygone inside the guest and checked out
`b1f7627e800be34d4bc9611b7ac4136789bb9d7a` detached. Installed repository
dependencies, Xvfb, and the Linux GUI libraries needed by the test runtime.
The host checkout and guest production source remain clean. No commit, push,
feature implementation, or host-folder sharing was performed.

The separate guest harness uses `@vscode/test-electron` 3.1.0 and downloaded
VS Code 1.143.1 for Linux ARM64. It launches an actual Extension Development
Host under Xvfb, with isolated user data and synthetic Git repositories.
This follows the official
[Extension Testing workflow](https://code.visualstudio.com/api/working-with-extensions/testing-extension).

The harness bundles the existing `DiffViewProvider` and uses the real Bygone
renderer. A test-only adapter changes panel routing to one stable, beside-source,
focus-preserving panel; a small experimental controller adds target generation,
pin/resume, and close cancellation. These changes live outside the checkout.

## Results

Baseline: `npm test`, `npm run lint`, and `npm run package:vsix` passed.
The test run includes the legacy runner plus 215 Node tests, with zero failures
or skipped tests in the latter. VSIX packaging produced a 13-file package.

All 12 final Extension Host probes completed successfully:

- Shipping extension activation and command registration.
- A control confirming the existing provider takes focus.
- Real renderer loading beside the source while a typing command still edits
  the source; undo restores that edit.
- Background document opening leaves the target unchanged.
- Rapid file switches discard a deliberately delayed A request and settle on
  C in the same panel.
- Unsaved edits, undo, and save refresh the diff; querying the renderer's actual
  Monaco buffer confirms it contains the unsaved source text.
- Pin holds the target, focusing Bygone does not retarget it, and resume follows
  the source again.
- The built-in TypeScript provider returns a hierarchical function symbol.
- The built-in Git extension exposes the fixture repository and a state-change
  event API. Automatic event handling itself was not implemented or tested.
- A linked worktree resolves its own root, HEAD, and file blob.
- An adversarial test reproduces the existing asynchronous refresh race.
  This probe succeeds by detecting a defect; it does not certify race safety.
- Closing during a delayed load prevents a late render and panel resurrection.

Four additional Git primitive checks passed: unborn HEAD detection;
HEAD/index/disk separation; absent paths versus invalid revisions; and paths
containing spaces or colons. These verify resolver building blocks, not a
finished resolver's error handling.

The renderer acknowledged 16 completions. Three collected request-to-completion
samples were 540, 33, and 8 ms. The fixture is tiny and the sampling incomplete;
these are observations, not a performance benchmark or target.

## Required scope adjustment

The existing `refreshCurrentDocumentDiff` reads its left source, awaits, reads
its right source, and constructs output using mutable provider state. Pausing
between those reads and switching A → B produced A's baseline with B's buffer.
The first slice must snapshot comparison identity and sources, then reject
stale refreshes before publishing. A generation guard around Git resolution
alone does not protect the existing document-refresh queue.

Keep the first delivery to HEAD → current buffer, a single read-only follower,
Pin/Resume, explicit unsupported states, and safe lifecycle handling. Git
baseline selection/events and symbol navigation remain separate follow-ups;
both have usable host APIs, but their complete integration is unproven.

## Evidence and reproduction

Persistent guest locations:

- Checkout: `~/projects/bygone`.
- Harness: `~/projects/bygone-follow-spike/`, including
  `run.cjs`, `suite.cjs`, `results.json`, `git-results.json`, and `runtime.json`.
- Logs: `~/projects/bygone-feasibility-logs/`, including setup,
  baseline, final host run, three earlier host attempts, exit statuses, and audit.

Run the host probe from the laptop with:

```sh
limactl shell agent-prototype bash -lc \
  'cd ~/projects/bygone-follow-spike && timeout 120s xvfb-run -a node run.cjs'
```

The runner requests stable VS Code; `runtime.json` records the resolved version.
Pin its download argument to `1.143.1` when reproducing this exact runtime.
It restores only its own synthetic fixture before a run, and creates a new
isolated VS Code user-data directory.

Earlier harness attempts exposed two test assumptions: panel activation and
editor-focus notifications arrive separately, and typing an auto-closing
comment creates multiple undo units. Waiting for the actual focus transition
and using one ordinary character resolved them without production changes.

## Remaining limits

No human visual QA, macOS host behavior, minimum supported VS Code version,
remote/virtual workspaces, large-file benchmark, reload restoration, external
file-edit behavior, or full Git-event lifecycle was tested. Standalone Electron
smokes were skipped because this spike concerns the VS Code integration.
Historical symbol correspondence was not tested. The prototype's production
race remains unfixed; its fix needs a regression test during implementation.

The dependency audit reported a critical DOMPurify finding and a moderate
fast-uri finding in the pinned baseline. Details are retained in `audit.json`;
no dependency remediation or exploitability assessment was performed here.
These are separate from the passing build and integration checks.

Confidence would change if representative repositories expose unacceptable
latency, the target supported VS Code version behaves differently, or human
QA finds disruptive focus/layout behavior not captured by the host assertions.


## Implementation follow-up — 2026-10-23

The user approved implementation after the feasibility report. The first slice is
implemented on `feat/vscode-following-mode`, based on
`b1f7627e800be34d4bc9611b7ac4136789bb9d7a`, with uncommitted changes in:

- Guest: `~/projects/bygone` in `agent-prototype`.
- Host review copy: `~/code/worktrees/bygone-vscode-following`.
- Exported patch, VSIX, and verification logs:
  `~/code/artifacts/bygone-following-mode`.

Delivered behavior: one read-only HEAD-to-buffer follower; focus-preserving file
switches; dirty/save/undo updates; Pin/Resume/Refresh; explicit clean, absent, and
unsupported states; paused history and restoration; bounded asynchronous Git
reads with cancellation and request/version guards. Baseline and buffer limits
are 128 KiB and 5,000 lines. Renamed files use the new path without guessing an
old-path mapping. External Git changes refresh on activation/window focus or the
explicit Refresh action. Symbol navigation and deeper Git events remain deferred.

The previously reproduced document refresh race is fixed. Comparison setup also
captures its originating panel across language resolution, preventing a delayed
manual comparison from replacing the follower. VS Code 1.74 preserved the active
group but dropped keyboard focus on initial webview creation; restoring the
source once during the explicit start command fixes this. Automatic updates do
not reveal, move, or focus the pane.

Validation in the Linux ARM64 VM:

- `npm test`: existing legacy assertions and all 215 existing Node tests pass;
  all seven new Git-baseline tests pass.
- `npm run lint` and TypeScript checking pass.
- `npm run test:following`: all 16 production-controller/renderer scenarios pass
  on both VS Code **1.74.0** and **1.143.1**, with isolated profiles and synthetic
  repositories. These cover real source typing, Monaco buffer contents, rapid
  switches, delayed/cancelled reads, dirty/save/undo, pinned buffer updates without
  Git reads, changed HEAD, unsupported text/custom/SCM tabs, explicit history,
  stale comparison setup/refresh, closure, and paused serializer restoration.
- `npm run package:vsix`: succeeds with the intended 13-file extension payload.
- `git diff --check`: passes. Existing dependency versions were not upgraded;
  `@vscode/test-electron` 3.1.0 and its test dependencies were added.

Reproduce the extension-host suite after `npm ci` with:

```sh
xvfb-run -a npm run test:following
BYGONE_VSCODE_VERSION=1.74.0 xvfb-run -a npm run test:following
```

The new reproducible harness lives in `scripts/test-following.mjs` and
`test/vscode/`; the older feasibility harness is retained as historical evidence.
The new runner copies production assets into an isolated test extension, observes
real instances through a test-only entry, and waits for actual renderer readiness.
It does not replace the user's installed extension. Downloaded VS Code runtimes
are excluded from lint, Git, and the VSIX payload.

Confidence is high for the bounded first slice under the tested hosts. Human
visual/macOS QA, a complete window-reload round trip (the serializer is exercised
directly), representative large-repository performance, external disk edits,
and remote/untrusted host scenarios were not exercised. Standalone application
smokes were skipped because implementation targets the VS Code integration.
Failures in those environments would change the compatibility assessment.
No source commit, push, PR, or host installation was performed.
