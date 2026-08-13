# Editor power inside Bygone

## Status

Detailed implementation plan. Editing remains inside Bygone's comparison
panes. The VS Code extension progressively projects VS Code document and
language capabilities into Monaco; standalone shares the editor substrate and
syntax layer but does not promise the VS Code extension ecosystem.

The plan is deliberately kill-gated. Reliable document synchronization,
undo/redo, and stale-result handling must be proven before completion, hover,
navigation, or refactoring work proceeds.

## Product decision

Do not split the user's attention between a Bygone comparison and a native VS
Code editor. The Bygone pane is the editor.

Preserve the capabilities that make the surface Bygone:

- conservative line matching and inline change emphasis;
- connectors and synchronized scrolling;
- active-change, file, history, and tour navigation;
- focused multi-panel layout;
- explicit source provenance and mutability; and
- copy-across and comparison-aware search.

Add editor power within that surface:

- correct language mode and syntax behavior;
- ordinary typing, selections, multi-cursor, find/replace, undo, dirty state,
  save, and external-change behavior;
- diagnostics and hover;
- completion and signature help;
- definitions, references, symbols, and lightweight peek/navigation;
- formatting and selected code actions; and
- later, carefully bounded rename, semantic tokens, and inlay hints.

An optional **Open in Default Editor** command may remain as an escape hatch,
but it is not the design, the normal workflow, or a dependency of this plan.

## What “full” means

“Full” means that the common inner loop feels like editing in VS Code while
the comparison remains visible:

1. Type with language-aware indentation, brackets, comments, completion, and
   signature help.
2. See diagnostics and explanatory hover without leaving the pane.
3. Navigate to definitions or references through an in-place peek experience.
4. Format or apply a safe code action and see every affected comparison update.
5. Undo, redo, save, and respond to external changes without corrupting either
   the VS Code document or the Bygone comparison.

It does not promise automatic compatibility with every extension-contributed
editor command, inline chat, debugger decoration, CodeLens provider, custom
webview, keybinding, or proposed VS Code API. Those are native workbench
integration points, not portable language-provider data.

The UI must state capability honestly. A pane may be:

- **Full editing:** document editing plus the available language-provider
  features for that source.
- **Basic editing:** document editing, syntax, and Monaco ergonomics when no
  language provider is available.
- **Read-only language view:** syntax and any safe provider results available
  for a historical or synthetic source.
- **Plain text:** stable editing or viewing without language intelligence.

Absence of a language server or extension is a normal capability state, not an
error.

## Current implementation and constraints

The 0.8.0 extension already supplies a useful foundation:

- editor-area `WebviewPanel` tabs host Bygone comparisons;
- trusted local worktree panes are backed by VS Code `TextDocument`s;
- Monaco edits are applied through `WorkspaceEdit`;
- `onDidChangeTextDocument` refreshes open Bygone tabs;
- equivalent comparisons reuse a tab and independent pairs remain independent;
- file-pair and file-history tabs restore after reload; and
- historical, remote, virtual, and synthetic inputs are explicitly read-only.

The gaps are substantial:

- Monaco models are created as `plaintext`, without source URIs;
- folding is disabled and only a generic editor worker is packaged;
- two-way editing sends complete left and right document strings after a
  debounce;
- the extension applies whole-document replacements;
- one global `applyingDocumentEdit` flag suppresses document-change handling;
- Monaco and VS Code can develop competing undo histories;
- language-provider requests have no protocol, cancellation, version, or
  result-size contract; and
- `DiffViewProvider` currently combines panel registry, serialization,
  document synchronization, message routing, view construction, history,
  directory, and multi-panel state.

VS Code exposes commands for invoking registered completion, hover,
definition, reference, formatting, semantic-token, inlay-hint, code-action,
and rename providers. Monaco exposes corresponding provider registration
points. The APIs make a bridge possible; they do not solve synchronization,
conversion, UI, security, or lifecycle automatically.

## Decision pass

### Responsibilities

| Responsibility | Variation | Owner | Construct |
| --- | --- | --- | --- |
| Source identity and mutability | Closed: document, snapshot, memory | Shared model | Discriminated union |
| Monaco model identity and lifecycle | Stateful per pane | Renderer | Small lifecycle object |
| VS Code document synchronization | Stateful per document and panel set | Extension host | Small coordinator class |
| Language request/response messages | Closed feature set per protocol version | Shared protocol | Discriminated unions plus runtime parsers |
| Provider execution | Open because installed extensions vary | Extension host | Narrow adapter interface and functions |
| Monaco feature registration | Closed to shipped bridge features | Renderer | Registration functions returning disposables |
| Capability presentation | Closed user-visible states | Renderer | Discriminated union |
| Standalone intelligence | Credible future providers vary | Desktop host | Separate optional adapter, not fake VS Code |

### Current, credible next, and speculative work

**Current:** Monaco text editing, find/replace, multi-cursor behavior inherited
from Monaco, comparison recomputation, `TextDocument` ownership in VS Code,
dirty state, save, word wrap, and read-only source gating.

**Credible next:** source-aware models, syntax and folding, robust incremental
document synchronization, diagnostics, hover, manual completion, signature
help, document formatting, definition/reference results, and an in-place peek
surface.

**Speculative until measured:** automatic completion triggers across arbitrary
providers, workspace-wide rename, arbitrary code-action commands, semantic
tokens for every provider, CodeLens, inlay hints, inline completions, inline
chat, arbitrary extension commands, and a general standalone LSP ecosystem.

Do not introduce abstractions whose only consumers are speculative features.

## Architecture

### 1. Source bindings

Adapt the existing session/source descriptors into one renderer-facing union;
do not create a second authority for Git or filesystem identity.

```typescript
type PaneSourceBinding =
    | {
        kind: 'document';
        paneId: string;
        uri: string;
        languageId: string;
        editable: boolean;
        documentVersion: number;
      }
    | {
        kind: 'snapshot';
        paneId: string;
        sourceId: string;
        displayPath: string;
        languageId: string;
        contentVersion: number;
        provenance: 'git' | 'tour' | 'explanation' | 'supplied';
      }
    | {
        kind: 'memory';
        paneId: string;
        bufferId: string;
        languageId: string;
        editable: boolean;
        contentVersion: number;
      };
```

`paneId` identifies a rendered pane instance. `uri`, `sourceId`, or `bufferId`
identifies its content. A restored tab receives a new `sessionEpoch`, so late
messages from a disposed webview cannot target the restored session.

All serialized panel state and all webview messages enter as `unknown` and are
validated before use. The renderer never chooses writability from a filename
or URI scheme.

### 2. Monaco model registry

Replace anonymous `value: ''` editors with source-aware models:

- create one `ITextModel` per active pane binding;
- give each model a stable, non-secret URI derived from the binding identity;
- set its mapped Monaco language ID at creation;
- attach and detach models without recreating them during ordinary diff
  recomputation;
- preserve view state, selections, scroll, find state, and undo state when the
  comparison model changes around it; and
- dispose models, feature requests, decorations, and subscriptions with their
  owning panel.

Never place source text, absolute paths, Git credentials, or opaque extension
arguments in Monaco URI query strings, logs, serialized webview state, or
telemetry.

### 3. Document synchronization coordinator

Document synchronization is the prerequisite for all other work.

The current whole-document debounce becomes a per-document state machine:

```typescript
type DocumentSyncState =
    | { kind: 'synced'; hostVersion: number; clientRevision: number }
    | { kind: 'sending'; hostVersion: number; clientRevision: number; requestId: string }
    | { kind: 'coalescing'; hostVersion: number; clientRevision: number; requestId: string }
    | { kind: 'conflict'; hostVersion: number; clientRevision: number; reason: string }
    | { kind: 'disposed' };
```

Use a small `DocumentSyncCoordinator` because this responsibility has real
identity, queues, invariants, and disposal. Maintain one coordinator per VS
Code document URI, shared by every open Bygone panel displaying that document.
Do not retain the global `applyingDocumentEdit` flag.

#### Edit flow

1. Monaco applies a local edit immediately.
2. The renderer records the `IModelContentChangedEvent`, increments a monotonic
   client revision, and coalesces a short burst.
3. At most one edit request per pane/document is in flight.
4. The request contains `sessionEpoch`, `paneId`, source identity,
   `baseHostVersion`, `clientRevision`, and bounded text edits—not both complete
   documents.
5. The extension validates the binding, version, edit count, ranges, and total
   inserted bytes before creating a `WorkspaceEdit`.
6. The per-document coordinator serializes edits and applies them.
7. `onDidChangeTextDocument` is the authoritative acknowledgement. It carries
   the resulting document version and content changes to all bound panels.
8. The originating pane recognizes its own accepted edit without resetting its
   Monaco model. Other panes apply the authoritative incremental changes.
9. If more local input accumulated while the request was in flight, the
   renderer computes the next bounded batch against the acknowledged state.

Use full content only for initial load and explicit resynchronization. A full
resync must preserve view state and must not silently overwrite unacknowledged
local input.

`WorkspaceEdit` does not expose an atomic document-version precondition. The
coordinator must therefore recheck immediately before application, record the
expected preimage and postimage, and attribute the resulting
`TextDocumentChangeEvent` to the pending request. If another extension or view
interleaves a change, accept the result only when the observed event and final
content match the expected transaction exactly. Otherwise stop, retain the
known states, and enter conflict. Automatically roll back only when the exact
postimage is still present; never “repair” a document that changed again.

#### Conflict flow

If the VS Code document version no longer matches the request base:

- stop sending edits for that binding;
- obtain the authoritative document content and version;
- if there are no unacknowledged local edits, apply the external changes and
  resume;
- otherwise enter `conflict` and offer **Use VS Code document**, **Keep Bygone
  edits**, or **Compare both**;
- never resolve a dirty conflict by last-write-wins; and
- keep other panes/documents responsive.

#### Undo/redo gate

The spike must determine one supportable contract:

- **Preferred:** Monaco undo/redo emits inverse edits that are applied as
  normal `WorkspaceEdit`s, while acknowledgements do not create duplicate
  Monaco undo elements. Native VS Code changes, including undo performed
  elsewhere, arrive as authoritative external edits.
- **Fallback:** Bygone owns a documented pane-local undo stack for edits made
  inside Bygone, while VS Code owns document dirty/save state. Opening the same
  document in a native editor may create a separate undo boundary.
- **Reject:** two active undo stacks can corrupt content, replay stale ranges,
  or oscillate through the document-change listener.

Do not claim full editing until the preferred or an explicitly accepted
fallback contract passes the manual matrix.

### 4. Language feature protocol

Use closed request and response unions instead of a bag of optional fields:

```typescript
type LanguageRequest =
    | { kind: 'hover'; position: TextPosition }
    | { kind: 'completion'; position: TextPosition; trigger: 'manual' | 'character'; character?: string }
    | { kind: 'signature'; position: TextPosition; character?: string }
    | { kind: 'definition'; position: TextPosition }
    | { kind: 'references'; position: TextPosition; includeDeclaration: boolean }
    | { kind: 'formatDocument'; options: FormatOptions }
    | { kind: 'codeActions'; range: TextRange; only?: string };

type LanguageResponse<T> =
    | { kind: 'ok'; requestId: string; documentVersion: number; value: T; truncated: boolean }
    | { kind: 'unavailable'; requestId: string; reason: string }
    | { kind: 'stale'; requestId: string; currentVersion: number }
    | { kind: 'cancelled'; requestId: string }
    | { kind: 'failed'; requestId: string; message: string };
```

Every request also includes protocol version, `sessionEpoch`, request ID,
binding identity, and expected document/content version. Runtime validators
enforce all fields and bounds.

The webview sends cancellation when cursor, selection, source, or content
changes make a request irrelevant. VS Code's provider-execution commands do
not uniformly accept cancellation tokens, so the host may be unable to stop
installed provider work; it must still drop late results and cap concurrent
requests.

### 5. Provider adapter

Define the adapter from Bygone's needs, not from the entire VS Code API:

```typescript
interface LanguageFeatureAdapter {
    request(binding: DocumentBinding, request: LanguageRequest): Promise<LanguageResponse<unknown>>;
    diagnostics(binding: DocumentBinding): readonly DiagnosticResult[];
}
```

The VS Code implementation executes documented provider commands and reads
`languages.getDiagnostics`. The standalone implementation initially returns
`unavailable`; syntax does not require this adapter.

Keep feature conversion in separate pure functions. Do not create a base class
hierarchy for providers.

### 6. Capability state

Each pane receives a host-calculated capability map:

```typescript
type FeatureAvailability =
    | { kind: 'available' }
    | { kind: 'read-only' }
    | { kind: 'unavailable'; reason: 'no-provider' | 'source-kind' | 'untrusted' | 'host' }
    | { kind: 'temporarily-disabled'; reason: 'stale' | 'conflict' | 'busy' };
```

Show capability explanations only when the user invokes an unavailable action;
do not add permanent status clutter to every pane.

## Feature slices

### Syntax, language configuration, and folding

For VS Code document bindings, use `TextDocument.languageId` as authoritative.
For snapshots and memory buffers, infer from the original display path and
allow explicit override. Map VS Code language IDs to Monaco IDs in one tested
registry.

Initial language set:

- JavaScript and TypeScript;
- JSON, HTML, CSS, and Markdown;
- YAML;
- Python;
- shell scripts; and
- plaintext fallback.

Add languages only with an open-source fixture, a path/language mapping test,
and measured bundle impact. The current webview bundle is close to its 2.9 MB
budget, so the spike must compare:

1. statically importing a bounded basic-language set;
2. generating separately loadable language chunks; and
3. using a smaller grammar/tokenization strategy.

The chosen approach must work in VS Code webviews, Electron, and the browser
presenter under their content-security policies. Do not relax CSP or permit
workspace resource loading merely to load grammars.

Enable folding only after line mapping, connector redraw, synchronized scroll,
change navigation, and tour anchors behave correctly with collapsed regions.

### Diagnostics

Diagnostics are the first bridged language feature because they are passive,
high value, and do not mutate source.

- Read initial diagnostics with `languages.getDiagnostics(uri)`.
- Subscribe to `languages.onDidChangeDiagnostics` and filter to bound URIs.
- Convert severity, range, source, code, tags, and bounded related information
  into Monaco marker data.
- Stamp each payload with the captured document version and discard it if the
  pane has moved on.
- Cap markers per document and disclose truncation.
- Clear markers on source change, panel disposal, provider disappearance, or
  transition to an unsupported snapshot.

Never send diagnostic command links or unbounded related-document content into
the webview.

### Hover

Invoke all registered hover providers for a document/position and merge their
results in provider order.

- Convert plain text and Markdown into Monaco hover contents.
- Sanitize HTML and disable command URIs by default.
- Bound item count and rendered bytes.
- Ignore results returned for a stale document version or cursor epoch.
- Present “no provider” as normal absence, not a notification.

### Completion and signature help

Start with explicit `Ctrl+Space`. Automatic trigger-character completion comes
only after latency and request-volume data are acceptable.

Initial completion support includes:

- label, kind, detail, documentation, sort/filter text, preselection;
- plain insert text and a bounded snippet subset;
- one primary same-document text edit; and
- a fixed maximum item and resolve count.

Initially exclude:

- arbitrary completion commands;
- workspace-spanning additional edits;
- items whose edit ranges do not validate against the request version; and
- extension-specific payloads that cannot be serialized safely.

Keep opaque provider objects in a short-lived host cache keyed by request and
item IDs. The webview receives normalized display/edit data, never command
arguments or extension-owned objects. Dispose the cache on version change,
request replacement, timeout, or panel close.

Signature help follows the same version, trigger, cancellation, conversion,
and bounds rules.

### Definitions, references, and symbols

Querying providers is straightforward; presenting results without leaving
Bygone is the difficult part.

Build one in-place **peek** component owned by the active pane:

- a compact result list when more than one location exists;
- a read-only preview model for the selected destination;
- path, source identity, and read-only state in the peek header;
- keyboard navigation, Escape to close, and focus restoration;
- no replacement of the underlying comparison model; and
- bounded cached content released when peek closes.

Worktree destinations may offer **Open as comparison pane**. Historical and
synthetic destinations retain provenance and remain read-only. Do not create a
hidden native editor or silently replace the comparison source.

Start with definitions. References and document/workspace symbols reuse the
peek result model only after definition navigation is stable.

### Formatting

Document and selection formatting execute in the extension host against the
authoritative VS Code document version.

- Retrieve `TextEdit`s from the provider.
- Validate and normalize overlapping edits.
- Apply through the same document synchronization coordinator.
- Treat the result as one labeled edit transaction where possible.
- Refuse stale results and do not retry automatically.
- Recompute the diff once after the authoritative document change batch.

Standalone formatting requires an explicitly configured safe formatter adapter
and is separate work.

### Code actions and rename

These are late phases because they may execute extension commands, edit several
documents, create/delete/rename files, or require preview UI.

For the first code-action slice:

- request quick fixes only for the active diagnostic/range;
- show title, kind, preferred state, and diagnostic relationship;
- retain command/edit payloads as opaque host handles;
- allow same-document text edits after version validation;
- require confirmation for multi-document edits;
- refuse file operations and arbitrary commands until separately designed; and
- gate execution on workspace trust and the installed provider's availability.

Rename requires a dedicated prompt, prepare-rename validation, preview grouped
by file, workspace-version revalidation, atomic `WorkspaceEdit`, rollback/error
reporting, and comparison refresh across every affected open file. It is not
part of the first “full editing” milestone.

### Semantic tokens, inlay hints, CodeLens, and inline completion

These remain optional after the core milestone:

- semantic tokens can materially improve highlighting but require legend and
  delta/version handling;
- inlay hints require viewport-bounded requests and refresh events;
- CodeLens often carries commands and adds vertical layout pressure that can
  disrupt alignment;
- inline completions have provider-specific lifecycle and acceptance behavior;
  and
- inline chat and debugger UI are workbench systems, not bridge targets.

Each needs its own evidence and layout review. Do not bundle them into a generic
“language bridge complete” task.

## Host behavior

### VS Code extension

The extension host is authoritative for:

- `TextDocument` content and version;
- `WorkspaceEdit`, dirty state, and save;
- installed language-provider execution;
- diagnostics and workspace trust;
- remote/virtual workspace document access through VS Code APIs; and
- opaque action handles.

Do not assume only `file:` URIs can be edited. Replace scheme checks with an
explicit capability decision based on source provenance, workspace trust,
document availability, and whether Bygone can safely apply an edit through VS
Code. Remote support must be tested rather than enabled by string matching.

### Standalone

Standalone shares:

- source-aware Monaco models;
- language ID mapping and bounded tokenization;
- indentation, brackets, comments, folding, find/replace, multi-cursor, and
  formatting UI contracts;
- capability-state presentation; and
- comparison-safe model lifecycle.

Standalone does not claim VS Code-provider features. Its initial adapter
returns `unavailable` for diagnostics, hover, completion, navigation, code
actions, and rename.

Possible later standalone options, each requiring a separate plan:

1. built-in JavaScript/TypeScript and JSON/CSS/HTML language workers;
2. explicit per-language adapters;
3. an opt-in LSP client with server discovery, trust, process lifecycle,
   workspace edits, diagnostics, cancellation, and compatibility policy; or
4. a quiet external-editor escape hatch.

Do not spawn language servers, execute workspace binaries, or read workspace
configuration merely because a file is opened.

### Browser presenter

The presenter remains read-only. It may consume the shared syntax layer but
does not load language providers or editing UI. Bundle costs must be evaluated
separately so editor improvements do not make tours unnecessarily heavy.

## Delivery plan and gates

### Phase 0: feasibility lab — 2 to 3 engineering weeks

Build disposable or narrowly integrated spikes using only open-source fixtures.

#### 0A. Source-aware model and syntax spike — 2 to 4 days

- Create URI- and language-aware Monaco models.
- Load TypeScript, Python, JSON, YAML, and plaintext tokenization.
- Exercise two-way, multi-panel, history, and tour rendering.
- Measure webview, worker, VSIX, desktop, and presenter bundle effects.

**Gate:** no broken anchors, connectors, navigation, CSP, or package budgets;
language loading strategy chosen with measurements.

#### 0B. Incremental synchronization and undo spike — 5 to 8 days

- Replace whole-document replacement for one two-way worktree fixture.
- Implement the per-document queue, version checks, acknowledgements, and
  explicit resync.
- Test rapid typing, paste, multi-cursor, replace-all, Monaco undo/redo, native
  external edit/undo, save, reload, two Bygone tabs, and panel disposal.
- Add artificial 50 ms, 250 ms, and 1 s host latency.

**Gate:** no lost/duplicated edits, stale-range application, feedback loop, or
silent overwrite in 100 repeated randomized edit sequences. A documented undo
contract is accepted before proceeding.

#### 0C. Diagnostics and hover spike — 2 to 4 days

- Bridge TypeScript diagnostics and hover.
- Validate cursor/version staleness, payload bounds, Markdown sanitization,
  missing-provider behavior, and panel disposal.

**Gate:** late results never decorate the wrong version or pane; hover does not
permit command-link or HTML injection.

#### 0D. Manual completion spike — 3 to 5 days

- Bridge `Ctrl+Space` TypeScript completions.
- Support a safe normalized subset and reject unsupported item behaviors.
- Measure latency locally and in a remote extension host.

**Gate:** median warm response under 150 ms and 95th percentile under 500 ms on
the fixture workspace, with no editing stall. If unavailable remotely, report
capability rather than simulating completion.

At the end of Phase 0, write a decision record with measured results. Stop or
reduce scope if document synchronization or undo cannot meet the gate.

### Phase 1: editing substrate — 2 to 4 engineering weeks

1. Add source bindings and runtime validation.
2. Extract panel registry concerns from `DiffViewProvider` without a wholesale
   rewrite.
3. Add model registry and view-state preservation.
4. Implement per-document synchronization coordinators and conflict UI.
5. Convert two-way document editing first, then writable history/worktree
   edges, then multi-panel documents.
6. Remove whole-document recompute messages and the global edit-suppression
   flag after all callers migrate.
7. Characterize save, dirty, refresh, close, restore, and external-change
   behavior before and after each seam.

**Exit:** basic editing is trustworthy even with every language feature
disabled.

### Phase 2: language presentation — 1 to 3 engineering weeks

1. Ship language ID mapping and the chosen grammar loading strategy.
2. Add comments, brackets, indentation, syntax, and tested folding behavior.
3. Preserve plaintext fallback and explicit override.
4. Update bundle budgets from measured, justified values rather than simply
   increasing ceilings.
5. Ship this layer to VS Code and standalone; decide separately whether the
   presenter receives it.

**Exit:** supported source files look and edit like their language without
affecting diff geometry or navigation correctness.

### Phase 3: diagnostics and hover — 2 to 4 engineering weeks

1. Add protocol envelopes, parsers, request registry, and disposal.
2. Add diagnostics subscription and marker conversion.
3. Add sanitized, bounded hover.
4. Add capability feedback for absent and disabled providers.
5. Test trusted/untrusted, local/remote, stale, high-volume, and provider-failure
   cases.

**Exit:** passive intelligence is stable enough to be on by default.

### Phase 4: completion and signature help — 2 to 5 engineering weeks

1. Ship manual completion with the safe item subset.
2. Add host-side opaque item resolution cache.
3. Add signature help.
4. Measure provider latency and request volume.
5. Consider automatic triggers per language only after measurements.
6. Add additional edits or commands only through explicit later gates.

**Exit:** common completion feels native enough for regular editing and fails
quietly when no provider exists.

### Phase 5: in-place navigation — 3 to 6 engineering weeks

1. Design and build one accessible peek component.
2. Add definition results and bounded preview models.
3. Add reference results and document symbols.
4. Add content fetching, caching, provenance, and disposal.
5. Test edits that stale a peek target and navigation across renamed/deleted
   files.

**Exit:** navigation never replaces or obscures the user's comparison state.

### Phase 6: formatting and safe quick fixes — 3 to 6 engineering weeks

1. Apply document/selection formatting through synchronized edit transactions.
2. Add quick-fix discovery and same-document edit actions.
3. Add preview/confirmation for multi-document edits.
4. Keep commands and file operations disabled until separately reviewed.

**Exit:** mutations are version-checked, undoable under the accepted contract,
and refresh every affected comparison exactly once.

### Phase 7: advanced mutations and decoration — separate projects

- workspace rename;
- broader code-action commands and file operations;
- semantic tokens;
- inlay hints;
- CodeLens; and
- inline completions.

Re-scope each from observed use rather than treating Phase 7 as an automatic
backlog.

## Estimated feasibility

| Milestone | Feasibility | Primary risk |
| --- | --- | --- |
| Source-aware syntax in both hosts | High | Bundle size and folding geometry |
| Reliable VS Code-backed editing | Medium | Undo and concurrent document changes |
| Diagnostics and hover | High | Stale results and safe Markdown conversion |
| Manual completion/signature help | Medium-high | Latency and lossy item conversion |
| Automatic completion | Medium | Trigger discovery and request volume |
| Definition/reference peek | Medium | UI, source loading, and focus lifecycle |
| Formatting | Medium-high | Edit transaction and stale-version handling |
| Safe same-file quick fixes | Medium | Opaque actions and mutation semantics |
| Workspace rename/general code actions | Medium-low | Multi-file preview, commands, file operations |
| Full arbitrary extension behavior | Not feasible | No public bridge for the whole native editor ecosystem |
| Standalone multi-language LSP parity | Low as one project | IDE-scale process, protocol, and compatibility work |

Expected effort through Phase 4 is roughly 9 to 19 engineering weeks including
the feasibility lab, depending on synchronization findings and remote support.
Phase 5 and Phase 6 add roughly 6 to 12 weeks. These are planning ranges, not
release commitments, and parallelizing work does not remove the Phase 0/1
dependency.

## Security and privacy

- Keep `localResourceRoots` limited to packaged extension resources.
- Preserve a strict content-security policy; do not add remote scripts or
  workspace paths.
- Treat every webview message and serialized state value as untrusted.
- Sanitize hover and diagnostic Markdown; disable command URIs and raw HTML by
  default.
- Keep provider objects, commands, and arguments in the extension host behind
  opaque expiring handles.
- Bound requests, results, text edits, preview content, diagnostics, completion
  items, and concurrent operations.
- Respect Workspace Trust. Provider execution may run code through installed
  language extensions; Restricted Mode capabilities must reflect what VS Code
  actually enables.
- Never log or persist source content, completion text, hover text, diagnostics,
  absolute proprietary paths, or provider payloads.
- Use only Bygone-owned open-source fixtures in tests, snapshots, demos,
  benchmarks, tours, and release artifacts.

## Performance budgets

Measure from keystroke/request to stable UI:

- local edit acknowledgement: median under 30 ms, p95 under 100 ms;
- diff recomputation after a burst: begin within 150 ms without blocking input;
- diagnostics application: under 50 ms for 500 markers after receipt;
- warm hover: median under 150 ms, p95 under 500 ms;
- warm manual completion: median under 150 ms, p95 under 500 ms;
- stale response discard: immediate and side-effect free;
- language payload: explicit per-request byte and item ceilings; and
- editor bundle: retain a checked budget with separate reporting for core,
  language chunks, workers, VSIX, and desktop artifacts.

Test small, medium, large, long-line, high-diagnostic, high-completion, and
provider-failure fixtures. Include local and remote extension-host latency.

## Verification matrix

### Sources

- two writable worktree files;
- worktree versus Git snapshot;
- history with an unsaved worktree edge;
- two read-only revisions;
- multi-panel mix of writable and read-only panes;
- blank memory buffers;
- tour and synthetic explanation stages;
- renamed, deleted, and externally changed files;
- local, multi-root, remote, virtual, trusted, and untrusted workspaces; and
- restored tabs after extension reload.

### Editing

- single typing, rapid typing, paste, large paste, IME composition;
- multi-cursor, snippets, replace-all, copy-across, and formatting;
- undo/redo before and after acknowledgement;
- undo/redo from another view of the same document;
- save, Save All, auto-save, reload, close with dirty content;
- two Bygone tabs showing the same document;
- external extension edit while Bygone has pending input;
- stale version, rejected edit, provider crash, panel close, and host restart;
- diff, connector, scroll, anchor, selection, and search-state preservation; and
- randomized edit sequences with artificial latency.

### Language features

- provider available, absent, slow, failing, returning empty, and returning
  oversized data;
- stale diagnostics, hover, completion, definition, and format results;
- Unicode, CRLF, surrogate pairs, tabs, long lines, and no final newline;
- Markdown/HTML/command-link injection attempts;
- edits with invalid, overlapping, cross-document, or file-operation payloads;
- provider activation in trusted and Restricted Mode; and
- unsupported snapshot URI schemes and language IDs.

Run the configured TypeScript compiler, lint, full automated suite, bundle
budgets, VSIX allowlist, desktop packaging checks, and manual Extension
Development Host matrix for each shipped phase.

## Acceptance criteria for the first major milestone

The first major milestone includes Phases 0 through 4. It is complete when:

- the user types, selects, multi-cursors, finds/replaces, undoes/redoes, saves,
  and handles external changes without leaving the Bygone comparison;
- worktree documents remain authoritative and no edit is lost, duplicated, or
  silently overwritten;
- syntax, language configuration, diagnostics, hover, manual completion, and
  signature help work when providers are available;
- unavailable features fail quietly with an accurate explanation on demand;
- historical and synthetic sources remain visibly read-only;
- late responses cannot affect a new document version, pane, tab, or session;
- diff matching, connectors, navigation, tours, and focused multi-panel layout
  retain their existing behavior;
- standalone receives the shared syntax/editing substrate without pretending
  to have VS Code language providers; and
- all validation evidence uses open-source Bygone fixtures.

Definitions/references, formatting, code actions, rename, semantic tokens,
inlay hints, and inline completion are not silently included in that milestone;
they retain their explicit later gates.

## Stop conditions

Pause and reconsider the product direction if any of these remain after the
feasibility lab:

1. Monaco and VS Code undo/redo cannot coexist under a clear, safe contract.
2. Remote-host acknowledgement latency makes ordinary typing visibly unstable.
3. Provider results cannot be versioned and discarded without wrong-pane or
   wrong-document effects.
4. Language loading breaks package budgets or requires weakening webview CSP.
5. Maintaining comparison geometry with folding or peek UI requires a second
   incompatible renderer.
6. Supporting a feature requires executing arbitrary extension commands from
   untrusted webview data.

A stop condition may reduce the supported capability tier; it does not justify
falling back to a clunky split-editor workflow without a new product decision.

## Primary references

- VS Code built-in provider commands:
  <https://code.visualstudio.com/api/references/commands>
- VS Code API, including diagnostics and document lifecycle:
  <https://code.visualstudio.com/api/references/vscode-api>
- VS Code Workspace Trust guidance:
  <https://code.visualstudio.com/api/extension-guides/workspace-trust>
- VS Code webview security guidance:
  <https://code.visualstudio.com/api/extension-guides/webview>
- Monaco editor and language provider APIs:
  <https://microsoft.github.io/monaco-editor/typedoc/modules/editor.html>

## Related plans

- [VS Code companion surface](vscode-companion-surface.md)
- [Standalone product surface](standalone-product-surface.md)
- [Refreshable sessions](session-refresh.md)
- [Focused multi-panel strip](focused-multi-panel-strip.md)
- [Diff matching between panels](diff-matching-between-panels.md)
