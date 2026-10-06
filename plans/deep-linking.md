# Deep links to Bygone views

## Status and recommendation

Scoped proposal; no deep-link implementation or protocol registration yet.

Give a Bygone location a versioned address containing its source, view, and
semantic focus. Start with links that reopen a local desktop comparison or
saved tour. Add portable repository and tour resolution as a separate phase.
Keep browser session URLs working through an adapter to the same target model.

The useful promise is explicit: a pinned link restores the identified evidence;
a live link opens the current local source. Never silently substitute another
revision, checkout, tour step, or file when the requested target cannot resolve.

## Current foundations and gaps

- `web/host.js` already writes tour location into URL parameters: mode,
  scene/step, narrative view, selected commits, scope, and file. These addresses
  can depend on a temporary loopback server port and a loaded-manifest ID.
- `src/uriHandler.ts` accepts VS Code `/diff?left=…&right=…` links to local files.
  Preserve that existing contract and the difftool integration.
- `src/desktopIntent.ts`, `standalone/launchArgs.js`, and `standalone/main.js`
  provide typed launch intents, single-instance forwarding, and native tour
  file opening. Desktop has no general URL opening route or public protocol
  registration.
- `src/workspaceGit.ts` already distinguishes repository, common Git directory,
  worktree, resolved commits, and live worktree/index sources. Reuse these
  checks; a remote URL alone does not identify a particular checkout.
- `src/tourDocument.ts` resolves a saved authored tour through its real path
  and enclosing repository. There is no general repository binding picker.
- `src/tourNavigation.ts` currently falls back to the first scene/step for
  unknown IDs. A new explicit deep-link request needs strict resolution.
- Some generated scene IDs in `src/changeTour.ts` are positional. Authored IDs
  are meaningful within a particular document; generated IDs alone cannot
  provide durable identity across regeneration.

## Target contract

Use a small discriminated target schema, independent of both CLI launch-intent
versions and `.bygone` format versions. The source determines which view and
focus fields are legal. Do not serialize the entire workspace or zoom session.

| Target | Source identity | View and focus |
| --- | --- | --- |
| Saved authored tour | Local document and repository binding; optional expected source/evidence fingerprints | Available tour mode; authored scene/step ID or tour/chapter overview; evidence file and optional revision/line |
| Git comparison | Exact repository binding and ordered full commit OIDs | Direct comparison; file; focused revision and line |
| Git file history | Repository, path at an identified commit, and selected commit OID | History mode and optional line; the surrounding history may grow |
| Live local comparison | Exact worktree or local file paths; explicit live operands | Ordered operands, file, focused operand and line |
| Portable tour, later | Repository locator, document path and source commit, plus resolved evidence dependencies | Same semantic tour focus, validated against the identified document |

Tour targets must distinguish a document reading location from a code-evidence
location. A step link should reveal that step's prose, not merely open its diff.

First-release Git comparisons use two pinned commits. Preserve their order.
Branch-review targets need their own explicit merge-base semantics and resolved
endpoints before they are supported; do not reinterpret a review as a direct
base-to-head diff. Multi-revision targets can extend the ordered operand list
once round-trip behavior is verified.

Use full Git OIDs, supporting the repository's hash format. A line is associated
with its file and revision/operand, never a visual panel index. A removed file
may exist on only one side. Binary files have no text-line target. Explicitly
report an unavailable line rather than highlighting a different one as exact.

Canonical tour mode names are `history`, `compare`, `historical`, and
`deconstructed`; UI labels can evolve independently. Accept existing browser
URL aliases through the compatibility adapter. Report an unavailable requested
mode. A link sets the requested mode's focus without overwriting unrelated
mode cursors or the reader's panel-density preference.

## Address and transport

Propose `bygone://open/v1?...` as the native public entry point, with readable,
percent-encoded query fields. Reserve the `open` authority; existing internal
`bygone://model/…` Monaco resource URIs are not launch targets.

Illustrative local tour address, shown decoded for readability:

```text
bygone://open/v1?kind=tour&repo=file:///Users/me/project&tour=reviews/change.bygone&mode=historical&scene=storage&step=write-path
```

The serializer must encode values with URL APIs. Use repeated ordered revision
fields for comparisons, not delimiter parsing. Final field names and bounds
should be fixed with codec fixtures before implementing OS registration.
Reject duplicate singleton fields and incompatible field combinations.

## Jumping to parts of a tour document

Make document locations first-class targets, shared by desktop deep links,
browser addresses, and self-contained HTML fragment links:

| Location | Stable selector within the identified document |
| --- | --- |
| Tour title/introduction | `part=title` |
| Chapter | `part=chapter` and chapter ID within its authored mode |
| Scene introduction/overview | `part=scene` and scene ID within its authored mode |
| Step prose | `part=step`, scene ID, and step ID within its authored mode |
| Review note | `part=review` and review item ID |
| Named prose field | Parent selector plus a supported field, such as step body or scene takeaway |

These field names illustrate semantics rather than freeze the wire format.
Selectors are structural IDs, not title slugs, array indexes, DOM IDs, or pixel
positions. Include the mode where IDs are mode-scoped. A chapter remains
addressable when the normal UI collapses a single chapter into the tour title;
explicit navigation must reveal its actual heading/content or explain why it
has no independently rendered content.

`src/tourReading.ts` already models title, chapter, scene, and step reading items.
`src/changeTourSource.ts` supplies IDs for review items. Extend these semantic
models rather than persisting their current DOM implementation. Review-note
links open the review panel and reveal the note; opening its code evidence is
a separate action. Do not silently equate prose focus with evidence focus.

Add “Copy link to this section” to headings and step/review-note menus. On open,
select the requested mode, expand the containing section, scroll the reading
pane to the target, move keyboard focus appropriately, and briefly highlight
it after layout settles. Respect reduced motion. If a target also specifies
code focus, validate and apply both without losing the document location.
Back/forward should restore deliberate document navigation.

First-release coverage: title, chapters, scene overviews, steps, and review
notes. Named prose fields can follow without a source schema change where the
field already has semantic identity. Arbitrary paragraph or selected-text links
need a separate anchor policy: prefer explicit authored block IDs for durable
current-document links. Paragraph numbers and text hashes do not survive edits.
A selection offset may be valid against an exactly pinned document only, with
the expected text checked before highlighting. No fuzzy matching that presents
a different paragraph as the original target.

Document targets refer to the rendered reading experience. Jumping to a line
in raw `.bygone` YAML is a distinct source-editor target and is deferred.

Provide “Copy link” in the workspace/tour menu and at a tour step. File/line
context menus add more precise focus where it is supported. Label local and
live links in the copy UI so users know their reach and stability. Include an
“Open link…” paste entry point for clients that do not activate custom schemes.
CLI ingestion can use the same codec without turning links into arbitrary CLI
argument payloads.

Inside Bygone, dispatch recognized links directly to the resolver. Extend the
tour prose allowlist deliberately: `media/tourProse.js` currently permits only
HTTP(S) links. Show “Open in Bygone” and “Copy link” for the new scheme; native
deep links do not go through the web preview surface.

Browser adapters should preserve existing URL forms and emit the same semantic
targets. Do not copy loopback ports, `/loaded/…` IDs, `workspaceEmbedded`, model
URIs, or renderer session IDs into durable native links. A standalone browser
without the necessary repository capability can offer desktop opening.

A hosted HTTPS launch page is a later distribution option. It needs an owner,
privacy decisions, and an app-not-installed experience; no hosting service is
required for the first release. Custom schemes will not be clickable in every
chat or document client, which is why paste-based opening matters.

## Local, portable, pinned, and live

Locality and stability are separate properties. A local Git comparison can be
pinned; a local worktree comparison is live. A shareable repository hint does
not make a moving branch reference immutable.

The earlier “never silently open different evidence” rule is a failure-handling
requirement, not a solution to identity. A complete link contract separates:

1. **Document identity:** which authored document/version or exported artifact.
2. **Evidence identity:** which resolved code snapshots and virtual panels it uses.
3. **Location identity:** which mode and semantic document/code target to reveal.

Offer two explicit link behaviors. **Current-document links** follow the current
saved document at its locator and retain a structural anchor through reordering
and title edits while IDs remain stable. Their code evidence can change with
branch refs. **Pinned snapshot links** identify an immutable document plus its
complete resolved evidence. The copy menu should distinguish “Copy link to current
document” from “Copy pinned snapshot link”; the latter is unavailable until a
resolvable pinned source or export exists. Do not silently downgrade it to current.

Pinning only the document commit is insufficient when its refs can move. Pinning
only code OIDs is insufficient when the narrative changes. A missing-target
message resolves neither problem. For a pinned request, materialize the exact
document and evidence, verify the anchor, or report that exact opening is not
possible. Recovery that opens current content must be a separate explicit action.

Authored structural IDs should be preserved across moves and wording changes
and should not be recycled for unrelated content. Validate uniqueness within
their scope. This is an authoring contract for current links, not a guarantee
that arbitrary future edits preserve meaning; pinned links supply that guarantee
for the materialized content. Renaming/deleting IDs breaks current links unless
an explicit future alias mechanism is added.

**Local first release:** use explicit local file URIs for repository/document
locations, canonicalize on resolution, and validate repository-relative paths.
Do not rely on a machine-local opaque registry ID as the only source locator.
Support saved tours and pinned comparisons first. Clearly identify saved-tour
links as reopening current source until evidence pinning is implemented.

An optional document fingerprint detects edits but does not freeze the Git
refs inside an unchanged document. For a stale link, offer an explicit action
to open the current source with focus validation. Unsaved buffers are not
captured by a link; the copy flow must say when it addresses saved disk state.

**Portable phase:** add a repository locator containing a shareable remote hint
and required object identities. Never serialize credentials from remote URLs.
Search known bindings, validate candidate objects, and ask the user to choose
when a mapping is missing or ambiguous. Record a binding only after successful
validation. Handle submodules as separate repositories. Live index/worktree
targets remain bound to their exact checkout.

**Pinned tours:** identify the authored document at its own Git commit/path
independently from the code range it presents. Resolve and pin every dependency,
including intermediate stacked-scene refs. Overriding only the top-level base
and head is insufficient. A document digest verifies content but cannot supply
an untracked or unavailable document. Prototype a complete dependency record
before promising immutable tour links or changing the tour format.

Existing compiled v1 manifests carry snapshot data; v2 tours also depend on an
origin repository for live views. Portability must be declared per capability,
not inferred from the existence of a JSON manifest. For generated views, use
file/evidence identity at pinned revisions rather than positional scene IDs.

## Resolution and recovery

Resolve in stages: parse and validate → locate source → verify identities and
capabilities → load → validate semantic focus → apply navigation. Keep the
current view available if preparation fails. Guard asynchronous results with a
navigation request ID so an older open cannot replace a newer request.

| Outcome | User experience |
| --- | --- |
| Exact target available | Open the requested view and focus |
| Explicit live target | Open current content with a live indication |
| Moved/missing local source | Locate replacement; revalidate identity before navigation |
| Multiple repository candidates | Choose a checkout; do not select by remote URL alone |
| Missing Git objects | Identify missing revisions and allow retry after the user obtains them |
| Changed document or missing scene/step | Explain what changed; offer current document/overview explicitly |
| Unsupported version, mode, or host capability | Explain the unsupported target and offer a compatible host when available |

Opening a link must not automatically clone, fetch, checkout, run commands from
the payload, or overwrite local changes. Route through existing unsaved-edit
protection. Load linked evidence read-only initially; an existing read-only
window cannot become editable through link fields.

Treat URLs as external input: bound total size and repeated fields, reject
unsupported schemes/authorities and malformed revisions, validate local file
URIs, and enforce containment for repository-relative paths after resolving
symlinks. Pass Git operands through safe argument boundaries, not shell text.
Keep remote document downloads and network-share file URIs outside the initial
scope. Local links can disclose local paths, so the copy UI should make that
property visible.

## Desktop and compatibility work

Integrate the resolver with existing launch routing and window ownership.
Handle cold start, warm start, minimized windows, and the macOS no-window state.
Queue opens until the destination is ready, avoid duplicate dispatch, and reuse
a matching tour window only after checking source identity. Apply focus after
the renderer acknowledges its loaded source.

Electron delivers macOS protocol opens through `open-url`; Windows/Linux use
launch arguments and second-instance handling. macOS and Linux also require
packaged registration metadata. Packaged cold/warm launch tests are necessary;
a development process is insufficient evidence. See the official
[Electron protocol-launch guide](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app).

Ship and verify macOS first. Scope Windows installer registration and Linux
desktop integration separately, including portable executable/AppImage behavior.
Preserve existing VS Code diff URLs. Complex desktop targets should use desktop
handoff rather than expanding VS Code into a full tour/workspace host.

## Delivery slices and acceptance

1. **Target codec and strict resolver.** Add typed source/view/focus targets,
   validation and round-trip fixtures. Adapt existing tour query parsing without
   breaking legacy URLs. Prove unknown IDs never silently select the first step.
2. **Local desktop links.** Saved tours and two-commit Git comparisons; Copy link,
   Open link, in-app dispatch, and packaged macOS protocol handling. Support
   current tour mode and document title/chapter/scene/step/review-note focus,
   plus comparison file/revision/line.
   Clearly label current-source tour links. Verify reopen after app restart.
3. **Additional local targets.** History, explicit live file/worktree targets,
   multi-revision order, and branch-review semantics. Implement each only with
   matching copy/open round-trip coverage and capability-specific focus.
4. **Portable pinned links.** Repository binding/recovery UI, independent tour
   source identity, complete evidence dependency pins, and cross-clone tests.
   Validate the dependency prototype before committing to a public tour-link
   format. Add other OS integrations as separately verified capabilities.

Test cold/warm dispatch, duplicate opens, delayed loads and unsaved edits;
Unicode/reserved characters and malformed URLs; moved tours, edited documents,
unchanged documents with moved refs, missing commits, ambiguous clones and
worktrees; absent modes/IDs/files/lines; deleted/binary files; read-only views;
legacy mode aliases and VS Code URLs. Use two clones and two worktrees to prove
portable committed content and live-checkout identity are handled differently.
Also test reordered/retitled chapters and steps with unchanged IDs, duplicate
IDs across different modes, deleted/reused IDs, single-chapter rendering, review
panel reveal, narrative-only targets, and combined narrative/evidence focus.
Prove pinned links cannot silently become current-document links when either
the document version or its evidence dependencies are unavailable.

Do not include complete window restoration, panel widths, scroll pixels, dirty
buffer transport, automatic network acquisition, or public artifact hosting in
this proposal's first release. Those are independent capabilities.

## Assessment and remaining validation

Confidence is high in the local-link approach: existing launch routing, tour URL
state, and repository resolution supply concrete foundations. Confidence is
moderate in a compact portable pinned-tour representation until a prototype
enumerates and replays all authored evidence dependencies in a second clone.
Failure to reproduce that evidence would favor a materialized portable artifact
for exact tour sharing instead of a larger URL payload.

The [self-contained HTML export proposal](self-contained-html-tours.md) scopes
that artifact separately. Share semantic focus with its fragment links; opening
an exported tour must not depend on native protocol registration or a local repo.

This scope was checked against current source and the related document-format,
workspace/history-bridge, and visible-panel proposals. No feature code, protocol
registration, packaged launch tests, or new runtime checks were performed for
this planning task. There is no rebuild/install requirement for this document.
