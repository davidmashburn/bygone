# Native editor power in Bygone

## Status

Scoped. Recommend native VS Code editor companionship for full language and
extension integration, modest Monaco improvements in both hosts, and no attempt
to reproduce a complete IDE inside the standalone app.

## Goal

Let a reader move from Bygone's comparison-specific view into a capable code
editor without losing the compared source, active change, selection, or
provenance.

"Full editor power" means the behavior users receive from a native VS Code
`TextEditor`: language modes, syntax and semantic highlighting, completion,
hover, diagnostics, definitions and references, symbols, formatting, code
actions and refactors, rename, inlay hints, CodeLens, extension-contributed
commands, user keybindings, accessibility, and normal document lifecycle.

It does not mean that historical or synthetic snapshots become writable, or
that Bygone must replace its matcher, connectors, focused multi-panel layout,
and guided-tour presentation with VS Code's standard diff UI.

## Recommendation

Treat the two editor experiences as companions:

- **Bygone view:** owns matching, alignment, connectors, change navigation,
  multi-panel layout, provenance, history rails, and tour focus.
- **Native VS Code editor:** owns full editing and language-extension behavior.
- **Standalone Monaco:** remains a capable local text editor for focused
  comparison edits, with syntax and ergonomic improvements where they are
  inexpensive; it does not become a language-server platform by default.

In the extension, add **Open Active Pane in Editor** and **Open in VS Code Diff
Editor**. Reveal the current Bygone line or selection in the native editor and
keep worktree document changes flowing back into the existing Bygone tab. For
read-only Git, tour, and synthetic sources, expose bounded virtual documents
with explicit provenance and language identity.

This provides actual VS Code power instead of a permanently incomplete Monaco
facsimile. The Bygone tab remains useful as the specialized comparison lens.

## Current evidence

The 0.8.0 extension already has the right document-ownership foundation:

- independent editor-area `WebviewPanel` tabs host two-way comparisons;
- trusted local files are opened as VS Code `TextDocument`s;
- Monaco changes are applied through `WorkspaceEdit`;
- `onDidChangeTextDocument` refreshes Bygone when the native document changes;
- historical and non-local content remains read-only; and
- restored file-comparison and history tabs retain source identity.

The limiting boundary is the editor view. The shared renderer creates Monaco
models with `language: 'plaintext'`, folding disabled, and a generic editor
worker. A Monaco instance inside a webview is not a VS Code `TextEditor`, so
installed extensions do not automatically contribute editor commands,
language UI, diagnostics, navigation, or refactors to it.

VS Code offers commands that invoke many registered language providers. A
Bygone extension could request completion, hover, definitions, formatting,
semantic tokens, inlay hints, code actions, and rename results for a real
`TextDocument`. That makes selected bridges technically possible. Each bridge
would still need a Monaco provider, message protocol, cancellation, version
and range mapping, result conversion, error handling, UI behavior, and tests.
It would not capture every extension-contributed editor behavior.

## Feasibility

| Capability | VS Code native companion | Monaco bridge in extension | Standalone |
| --- | --- | --- | --- |
| Syntax highlighting and language mode | Native | Low to moderate | Low to moderate with bundled grammars/basic languages |
| Multi-cursor, selections, find, undo | Native | Already mostly present | Already mostly present |
| Completion and signature help | Native | Moderate to high per bridge | High; requires a language service or LSP |
| Hover, definitions, references | Native | Moderate per feature | High |
| Diagnostics | Native | Moderate; mirror VS Code diagnostics | High; requires LSP/tool integration |
| Formatting, rename, code actions | Native | High due edits, previews, and workspace effects | Very high |
| CodeLens, inlay hints, semantic tokens | Native when providers support source | Moderate to high | High |
| Extension commands, keybindings, inline chat, debug integration | Native | Not generally reproducible | Not applicable without building an ecosystem |
| Exact Bygone matching and connectors | Preserved in companion tab, not native diff | Native to Bygone | Native to Bygone |

Overall feasibility:

- **Extension native companion:** high confidence, moderate effort.
- **A few Monaco intelligence bridges:** feasible, but should be justified one
  feature at a time by use inside the Bygone view.
- **Full VS Code parity inside the webview:** not a bounded or credible goal.
- **Standalone language-aware editing:** feasible in layers.
- **Full standalone VS Code parity:** effectively a separate IDE product and
  not proportionate to Bygone's current role.

## Product behavior

### Open Active Pane in Editor

From a Bygone file-comparison or history tab:

1. Resolve the active pane to an authoritative source descriptor.
2. Open a writable worktree URI with `showTextDocument`.
3. Open historical or synthetic content through a read-only Bygone virtual
   document URI.
4. Assign the language from the source path or known language ID.
5. Reveal the active change, cursor, or selection.
6. Preserve the Bygone tab and allow an explicit command to return to it.

Worktree edits made in the native editor already flow back through
`onDidChangeTextDocument`. The implementation must retain granular VS Code
edits and undo history; Bygone must not replace the entire document merely to
acknowledge an external native edit.

### Open in VS Code Diff Editor

Open the two authoritative resources with the built-in `vscode.diff` command.
This is the highest-fidelity native editing option for a two-way comparison.

The command must make its tradeoff explicit: VS Code's diff editor supplies
native language and extension behavior but uses VS Code's diff presentation,
not Bygone's matcher, alignment, connectors, or annotations. The original
Bygone tab remains open for those capabilities.

For a worktree-versus-history comparison, the worktree side is writable and
the virtual historical side is read-only. Two historical sources are both
read-only. Synthetic explanation stages must be labeled as such in titles and
URIs.

### Follow mode

After the explicit open commands are stable, consider an opt-in **Follow
Active Change in Editor** mode. Bygone navigation reveals the corresponding
line in an already-open native editor without repeatedly stealing focus or
opening tabs.

Follow mode is credible next work, but automatic bidirectional cursor syncing
is speculative. It risks feedback loops, focus churn, and ambiguity when
several Bygone or native editor tabs show the same document.

## Source and lifecycle model

Use a closed discriminated union for sources Bygone owns:

```typescript
type EditorSource =
    | { kind: 'worktree'; uri: vscode.Uri; writable: true }
    | { kind: 'snapshot'; uri: vscode.Uri; path: string; revision: string }
    | { kind: 'explanation'; uri: vscode.Uri; path: string; stageId: string };
```

The exact shape can follow existing source descriptors; do not introduce a
parallel source model if one can be adapted. Runtime parsing must validate any
serialized panel state or virtual URI before it is treated as an
`EditorSource`.

Define a narrow native-editor adapter from the comparison controller's needs:

```typescript
interface NativeEditorGateway {
    openSource(source: EditorSource, location?: SourceLocation): Promise<void>;
    openDiff(left: EditorSource, right: EditorSource, title: string): Promise<void>;
    reveal(source: EditorSource, location: SourceLocation): Promise<void>;
}
```

The extension implementation wraps VS Code APIs. Tests use a small structural
fake. Monaco does not depend on VS Code types; the webview sends only validated
source identities and locations through the host protocol.

Virtual-document identity must include immutable source identity, not just a
display path. Content storage must be bounded and released when comparisons
close. Do not place proprietary source text in global state, logs, telemetry,
serialized webview state, or test fixtures.

## Selected Monaco improvements

Improve the embedded editor only where the feature is valuable while reading
a comparison and does not duplicate a large VS Code subsystem:

1. Detect and pass a language ID for every textual panel.
2. Enable syntax highlighting, bracket behavior, indentation, and folding for
   a deliberately bounded language set or a proven grammar-loading strategy.
3. In the extension, optionally mirror diagnostics for writable worktree
   documents after document-version and stale-range behavior is tested.
4. Add one-click native navigation for definition, references, formatting, or
   code actions rather than rebuilding their full widgets inside Monaco.

Do not start with completion, rename, refactors, CodeLens, inlay hints, or
inline chat in the webview. Those features have complex interaction and edit
semantics and are already available in the native editor companion.

## Standalone scope

The standalone app has no VS Code extension host. Monaco provides the editor
surface but not installed language extensions or their services.

Reasonable standalone work:

- infer language from paths and enable syntax, comments, brackets, indentation,
  folding, and formatting when a safe local formatter is explicitly available;
- add **Open Active Pane in External Editor** with a configured command and a
  safe `code --goto` path when VS Code is installed;
- preserve current file, line, column, and change identity during hand-off;
- watch writable files and offer the existing refresh/conflict flow after
  external edits; and
- keep historical and synthetic content read-only, optionally materializing a
  clearly temporary copy only after defining cleanup and provenance behavior.

A standalone LSP client is possible but should be a separate opt-in project.
It requires server discovery and configuration, process lifecycle, workspace
roots, protocol transport, cancellation, document versions, diagnostics,
workspace edits, progress, file watching, security boundaries, and per-server
compatibility. Supporting one controlled language server is an MVP; supporting
arbitrary user language ecosystems is an IDE program.

## Delivery plan

### Phase 0: capability spike — 2 to 4 engineering days

- Open the active worktree pane in a native editor at the active change.
- Register one read-only virtual snapshot and open it with the source language.
- Open the pair through `vscode.diff`.
- Verify TypeScript/JavaScript completion, hover, diagnostics, definition, and
  formatting on the worktree side using ordinary open-source fixtures.
- Record which language features operate on the virtual snapshot and which
  providers reject non-file or read-only resources.

Exit when the product tradeoff can be demonstrated, not when every language is
supported.

### Phase 1: native companion — 1 to 2 engineering weeks

- Add validated source descriptors and the native-editor gateway.
- Add the two explicit commands with editor-title and context-menu placement.
- Preserve selection/change location and Return to Bygone behavior.
- Implement bounded virtual-document lifecycle and language assignment.
- Cover worktree/worktree, worktree/history, history/history, remote, untrusted,
  missing-source, renamed-file, and restored-tab cases.

This is the recommended first release and captures most of the user value.

### Phase 2: follow mode and polish — 1 to 3 engineering weeks

- Add opt-in one-way reveal from Bygone navigation to an open native editor.
- Avoid focus stealing, tab proliferation, and event loops.
- Preserve line mapping across edits or disable follow with a clear stale-state
  explanation.
- Validate multi-root, remote, and virtual workspaces against explicit
  capability checks.

### Phase 3: bounded Monaco intelligence — 2 to 5 engineering weeks

- Add language IDs and syntax/folding behavior shared by extension and desktop.
- Evaluate diagnostic mirroring in the extension.
- Add native-editor command hand-offs for high-value language actions.
- Stop if a feature requires recreating VS Code's interaction model inside the
  webview.

### Separate standalone option

- External-editor hand-off: roughly 3 to 5 engineering days.
- Bounded Monaco language ergonomics: roughly 1 to 3 engineering weeks.
- One-language LSP MVP: roughly 4 to 8 engineering weeks after a dedicated
  design and security pass.
- Reliable multi-language LSP product: several months and ongoing maintenance.

These estimates are planning ranges, not commitments. The capability spike
should refine them.

## Rejected primary approaches

### Bridge every VS Code language feature into Monaco

Provider execution is technically available for many features, but every
feature needs protocol, mapping, UI, lifecycle, cancellation, and edit support.
Extension-contributed editor commands and behaviors still would not transfer.
This path creates an expensive compatibility layer that is always behind the
native editor.

### Replace Bygone with the native VS Code diff editor

This obtains editor power but discards the matching, connectors, annotations,
focused multi-panel behavior, and tour interactions that distinguish Bygone.
Offer it as an explicit companion view instead.

### Build full language-server support into standalone now

This changes the standalone product from comparison/presentation software into
an IDE host, expands its trusted execution surface, and creates unbounded
language-specific maintenance. Reconsider only after measured demand for
editing inside standalone exceeds demand for external-editor hand-off.

## Verification

- Unit-test source parsing, capability decisions, virtual URI identity,
  location mapping, and gateway calls.
- Integration-test document edits, undo/redo, dirty state, save, external
  changes, restore, and panel disposal without update loops.
- Test native open and diff behavior with open-source JavaScript, TypeScript,
  Python, and plain-text fixtures; do not use proprietary code.
- Verify historical and explanation sources remain read-only.
- Verify no source content enters logs, telemetry, serialized state, or release
  package assertions.
- Run the configured TypeScript compiler, lint, automated suite, VSIX allowlist
  check, and manual Extension Development Host matrix.
- Manually test accessibility, keybindings, multi-root workspaces, remote and
  virtual workspaces, workspace trust, missing language extensions, and
  unavailable language providers.

## Acceptance criteria

- A user can open the active Bygone pane or pair in native VS Code at the
  relevant change without losing the Bygone comparison.
- Worktree editing uses ordinary VS Code documents, extensions, undo, dirty
  state, save, and diagnostics.
- Read-only source provenance is visible and enforced for history, Git blobs,
  tours, and explanation stages.
- Bygone-specific matching and presentation remain available in the original
  tab.
- The standalone app gains no hidden language-server processes or workspace
  writes merely from opening a comparison.
- Any Monaco intelligence bridge has an explicit supported-feature boundary
  and graceful behavior when a provider is absent.

## Related plans

- [VS Code companion surface](vscode-companion-surface.md)
- [Standalone product surface](standalone-product-surface.md)
- [Refreshable sessions](session-refresh.md)
- [Focused multi-panel strip](focused-multi-panel-strip.md)
- [Diff matching between panels](diff-matching-between-panels.md)
