# HTML tour exports: Minimal and Full

## Status and proposed contract

Scope only; export is not implemented. Recommend a single, interactive,
read-only HTML file that opens directly from disk in a supported desktop
browser, without Bygone, Git, or a local server. Following the user's acceptance
of an internet requirement, recommend a pinned CDN viewer by default, with a
visible notice and a built-in load-failure message. Offer an embedded viewer
for offline use. The file should also work on a static host that permits scripts.

Both delivery variants contain all data required by the included tour views.
Only the embedded-viewer variant is fully self-contained. External links remain
external; neither variant includes the contents of linked websites.

Use two tour profiles, following the user's preferred direction:

- **Minimal (default):** all authored narrative modes and their required
  evidence, plus the final endpoint file comparison; no browsable Git history.
- **Full:** Minimal plus a minimal embedded repository snapshot supporting
  history and comparisons within the declared tour range and file scope.

Full means full exploration of the packaged scope, not the repository's entire
lifetime. Both profiles include intermediate snapshots explicitly needed by
authored steps; “no history” must not remove those steps. Implement Minimal first
and Full as a second slice, validating its data model before exposing the option.

Runtime delivery is independent: either profile can use the pinned CDN runtime
or the embedded offline runtime. These are two primary tour choices with an
“Embed viewer for offline use” option, not four competing tour profiles.

## Decisions worth making explicitly

| Decision | Recommendation | Tradeoff |
| --- | --- | --- |
| One file or asset folder | One HTML file is the first-release contract | Easy to move and attach; an embedded runtime increases each file's size |
| Interactive or static | Reuse the interactive tour reader and diff renderer | Several megabytes of runtime; preserves steps, modes, search, and connections |
| Tour or entire repository | Package the dependencies of included tour views | Repository-wide exploration is unavailable unless separately materialized |
| Full files or snippets | Full text of each included file revision | Preserves context, search, and line anchors; discloses surrounding code |
| Which modes | All authored modes plus fixed endpoint comparison by default | Larger than exporting only the currently visible step; avoids losing the story |
| Git history | Minimal omits it; Full includes a bounded repository snapshot | Full can grow much larger and expose old or deleted code |
| Runtime delivery | Pinned CDN by default; embed for offline use | CDN reduces attachment size but requires internet access |
| External assets and previews | No automatic fetching or embedding of linked pages | Offline links cannot preview a remote website |
| Narration | Optional local device speech; recorded audio later | Available voices and sound differ by machine |
| Compression | Deduplicate first; add compression only after measurement | Simpler boot path initially; larger raw attachment |

Minimal/Full and acceptance of internet access reflect the user's direction.
Detailed data boundaries and the recommended CDN default remain scope decisions;
this is not an implementation request.
A smaller static reading/print export can be considered separately; do not build
a second rendering system merely to avoid bundling the existing one.

## What the source already provides

- `src/changeTourManifest.ts` supports manifest versions 1, 2, and 3. Text diffs,
  walkthrough evidence, real stacks, and deconstructed panels contain resolved
  text. Version 3 includes independently authored mode tours.
- `src/changeTour.ts` resolves source refs into snapshots and records omitted
  files. Large/binary files can be represented as omissions. Export must retain
  that distinction rather than report every changed file as fully included.
- `cli/tour.js` compiles authored sources to JSON. There is no HTML export action.
- `cli/present.js` serves the viewer, manifest, history endpoints, tour loading,
  and narration coordination. `cli/tourHistory.js` requires the origin repository
  for v2+ history and runs Git for history and arbitrary comparisons.
- `web/host.js` fetches the manifest and history, assumes worker asset URLs, and
  uses local storage. Its mode/capability checks need an export-aware path.
- `media/script.js` creates editor and diff workers from host-supplied URLs.
  `scripts/build.mjs` already creates bundled browser IIFEs and embeds font data.
  This is useful packaging groundwork, not proof of `file:` compatibility.
- Existing tour prose uses text nodes and explicitly supported links rather
  than authored HTML. Preserve that boundary in the exported reader.

The six current viewer JS/CSS/worker files total 4,780,113 bytes, about 4.56 MiB,
before the HTML shell, tour data, export-specific changes, or encoding overhead.
This is a local build measurement, not a promised final export size.

## Included behavior and visible limits

| Capability | Minimal (default) | Full |
| --- | --- | --- |
| Title, chapters, scenes, steps, review notes | Included | Included |
| Historical and deconstructed authored modes | Include those present in the source | Same |
| Real and virtual panel text, focus, connections | Included with exact resolved evidence | Same |
| Files and directory overviews | Included within declared export scope | Within selected path/revision scope |
| Final endpoint comparison | Fixed exported endpoints | Fixed endpoints plus supported included revisions |
| Narrative and code search | Search included evidence; show scope | Also search selected historical evidence where implemented |
| Free choice of arbitrary commits | Unavailable | Only supported combinations of included revisions |
| File history and parent navigation | Unavailable | Stops explicitly at the exported boundary |
| Edit files, load another authored tour, refresh from Git | Unavailable | Unavailable |
| External links | Explicit open/copy | Same |
| Website previews | Unavailable | Unavailable |

The authored “Historical” mode is not the repository “History” browser. Keep
authored historical narratives and their stacks even when Git history is absent.
Show included capabilities and omissions in an “About this export” panel; hide
unavailable interactive controls rather than let them fail against missing APIs.
Expose fixed comparison endpoints clearly so they do not imply free selection.

For the default profile, include all changed-file endpoint text that backs its
Files view, plus all files/revisions referenced by authored modes, connections,
review evidence, and directory overviews. This can include files not narrated in
a step. Keep included text searchable without requiring the origin repository.
Search coverage should explicitly include intermediate and virtual panels or
clearly identify a narrower scope; do not label endpoint-only search “all code.”

Preserve authored omissions with reasons. Missing material required to render
an authored step is an export error, not a silently omitted step. Binary/image
rendering beyond existing tour support is deferred; omitted entries remain
visible. Submodules and Git LFS objects must not be fetched implicitly.

## Materialization and artifact identity

Compile and resolve all source dependencies once at export time. Pin refs before
reading evidence so a branch moving during export cannot produce mixed content.
Include virtual/deconstructed panel contents exactly as generated; their identity
is not necessarily a Git commit. Validate every focus and connection against
the exported content before writing a successful artifact.

Build a versioned export envelope with:

- Export format and bundled viewer versions, title, timestamp, and content ID.
- Capability/profile declaration and explicit file/revision scope.
- Semantic tour structure and a deduplicated table of text/assets addressed by
  content digest, with separate path/revision/panel metadata.
- Included and omitted material, resolved code OIDs, and source fingerprint.
- Optional source links and attribution, plus required runtime license notices.

Keep this envelope distinct from the authored source format. Do not fake a v1
manifest or retain a bogus `repository.root` just to bypass existing checks.
Use an export adapter with explicit capabilities and an in-memory source of
evidence. Make only the host seams needed for manifest loading, evidence access,
workers, preferences, and navigation; a general provider framework is unnecessary.

The original authoring file is not needed to view the export and should not be
embedded by default. Preserve its fingerprint and resolved narrative instead.
Strip local absolute roots and credential-bearing source URLs. Retain useful
relative paths, revision IDs, labels, and necessary authorship metadata; inventory
what is shipped, including commit messages/emails if retained. An export is not
automatically safe to publish because its local paths have been removed.

Derive content identity from canonical tour structure, scope, and evidence,
excluding export timestamps and machine-local locations. Track viewer version
and full artifact checksum separately. A checksum detects mismatch, not authorship
or trust. Semantic identity should survive renaming or moving the HTML file.

## Embedded offline browser runtime

For offline delivery, inline code, CSS, fonts, payload, and worker sources. Bootstrap
directly from embedded data; no manifest fetch or adjacent-file imports. Generate
Blob URLs for the bundled classic workers and release them when no longer needed.
This is the leading implementation approach, with `file:` browser behavior a
prototype gate. Blob workers and their CSP requirements are documented in
[MDN's Worker reference](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker).

Use tested HTML-safe serialization for text, JSON, scripts, CSS, and worker
payloads. Source containing `</script>`, markup, or Unicode edge cases must remain
inert data. Preserve text-node prose rendering and URL allowlists. Include a CSP
that blocks network connections and frames while allowing the exact bundled
scripts, worker blobs, styles, and embedded assets the renderer requires. Verify
actual Monaco style requirements before fixing the policy; do not rely on CSP
as a substitute for safe serialization. Worker policy is covered by
[MDN's worker-src documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src).

Do not load external previews, fonts, telemetry, or remote narration during
reading. Ordinary links open only after a user action and should disclose that
they leave the export. Do not crawl their destinations while exporting.

Make preferences best-effort and keep an in-memory fallback. Local storage on
`file:` URLs has undefined browser-dependent behavior, so it cannot be required
for startup or navigation. See [MDN's localStorage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
Clipboard support also needs a selectable-text fallback. Nothing written to
browser storage should be required when the file is copied to another computer.

Local speech may be offered when a suitable device voice exists; remote voices
must not be used implicitly. The browser distinguishes local and remote voices
with [SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).
Test offline playback before claiming support. Bundled recordings would offer
consistent audio but add size, generation, and rights decisions; defer them.

Require JavaScript for the interactive tour. Include a readable title, export
summary, and clear no-script/boot-failure message in the initial HTML. Full static
code rendering, print pagination, and mobile diff UX are separate follow-ups.
Test current desktop Chrome, Firefox, and Safari directly from disk and over
static HTTP(S). Hosted CSPs and email/document preview sanitizers can block the
viewer; document “download and open in a supported browser,” not email playback.

## Size, scope, and disclosure

Deduplicate identical text across steps, files, modes, and revisions; hydrate
only active editor models and bound caches. Do not precompute every pairwise
comparison for every revision: that can grow quadratically. Measure total bytes,
decoded data, peak memory, time to first readable scene, and navigation latency
on small, representative, and deliberately large tours.

Preflight should report runtime bytes, unique evidence bytes, largest files,
included modes/files/revisions, and omissions. Warn before writing an unusually
large export and fail at explicit safety limits; set numeric budgets from the
prototype rather than guessing attachment limits. Do not silently truncate
content or drop modes to hit a size target. Prefer plain deduplicated data for
the first prototype; compression must include its decoder or a verified fallback
and be justified by size and startup measurements.

Full file snapshots include surrounding and possibly deleted code. The export
summary should make that scope visible. Hiding a tab, collapsing a panel, or
removing a search result does not remove its underlying content. A future
snippet/redaction profile must rebuild and validate the evidence graph, anchors,
indexes, and counts; do not offer cosmetic redaction as content removal.

## Full profile: a minimal embedded Git repository

A Git tree describes directory entries; commits connect trees to parents, and
blobs supply file contents. History requires more than a single tree. See the
[Git data model](https://git-scm.com/docs/gitdatamodel).

Recommend a compact Git-derived object graph: original commit IDs and parent
relationships, scoped per-revision path/mode/blob mappings, and deduplicated blob
contents. Keep virtual panels in the tour evidence table; do not manufacture Git
commits for them. This supports Bygone's read-only operations without requiring
a general Git implementation in the browser.

Choose representation after a bounded prototype:

| Representation | Benefit | Cost / limitation |
| --- | --- | --- |
| Indexed Git-derived snapshot, recommended | Direct browser lookup, deduplication, scope-aware queries | A scoped view, not a valid clone or original Git tree; retain provenance OIDs separately |
| Original Git objects / pack data | Preserves native representation and may compress well | Needs browser object/pack decoding; shallow/missing-object boundaries and queries still need implementation |

Do not give a filtered path map an original Git tree OID as though its contents
were unchanged. Native objects must retain original bytes and hashes, with
missing objects declared. Metadata filtering can conflict with byte-exact Git
object preservation. Neither representation needs local config, credentials,
hooks, reflogs, an index, or a working directory.

Default Full scope should cover the tour's resolved base/head range, intermediate
commits in that range, and the union of files changed within it plus all authored
evidence dependencies. Files changed and later reverted still belong to that
union. Include base snapshots and rename predecessors needed to interpret files
at each included revision. Authored stack commits outside the range remain
explicit supplementary revisions, not permission to include all ancestors.
Present the resulting commit/path scope before export.

Require an explicit revision set or bounded range and path scope. A time or
commit-count limit by itself does not identify merge ancestry or rename paths.
Resolve boundaries to OIDs and record traversal/order/parent semantics. Mark
parents outside the snapshot as unavailable instead of silently extending it.

Materialize the required commit metadata, path identities, and file snapshots
while Git is available. Distinguish an absent file from a file not packaged.
Include enough path inventory and rename information for each supported query;
two arbitrary sparse snapshots do not prove repository-wide comparison parity.
Compute supported diffs in the browser or package a bounded set of precomputed
results. State the supported comparisons explicitly in the artifact.

No automatic “entire history” setting. Validate the data and memory model on
merges, renames, deleted files, and long histories before shipping Full. Preserve
merge-parent identities even when outside the exported boundary. Comparisons
must match local Git within declared scope; do not claim identical rename
inference outside it. An asset-directory/ZIP export may help very large tours,
but it should remain a separate delivery format, not a silent fallback.

## Pinned viewer from npm

The npm release can supply the viewer in either of two ways:

| Delivery | HTML contents | Network requirement |
| --- | --- | --- |
| Pinned CDN (recommended default) | Bootstrap, complete tour data, exact viewer asset URLs and integrity metadata | Internet required to load the viewer |
| Embedded offline | Viewer, workers, styles/fonts, and complete tour data | None to read; export may obtain a missing pinned viewer |

An exact npm version/file can be served through jsDelivr using
`https://cdn.jsdelivr.net/npm/package@version/file`. See
[jsDelivr's documentation](https://www.jsdelivr.com/documentation). Use an exact
release, never `latest`, a version range, or CDN-transformed code. Browser caching
can help loading, but is not an offline guarantee.

`scripts/package-npm.mjs` already puts browser scripts, styles, and workers into
`@davmash/bygone`. Its main entry is Electron code, and the current web host still
expects server routes. Publish a stable browser export entry point and asset
manifest in that package; do not load the package root or claim today's viewer
is already export-ready. A separate small viewer package is optional later.
Loading selected CDN files does not install Electron or execute npm scripts.

Pin the whole runtime set, including workers, styles/fonts, and transitive
chunks, to one release. Its manifest declares supported export schema versions.
Prefer matching installed assets for offline export; fetching a missing pinned
release must verify integrity and avoid lifecycle script execution. Record the
version and hashes actually used.

For CDN delivery, embed trusted expected asset hashes in the bootstrap, check
script/style integrity, and verify fetched worker bytes before creating Blob
workers. A manifest downloaded beside the code is not an independent integrity
anchor. Test CORS/integrity handling from local-file and hosted origins. Allow
only the pinned asset origin in this variant's network policy. Missing assets
or incompatible versions fail clearly; never silently upgrade to another release.

Keep “Internet required to load the Bygone viewer” visible in the export details
and initial HTML shell. Put loading, timeout, blocked-network, and integrity-error
messages in that shell/bootstrap so they do not depend on the CDN script arriving.
Offer retry and explain how to obtain an offline export. With JavaScript disabled,
show the title, summary, and an explanatory message. Never leave a blank page.

Tour data stays embedded and is not uploaded to npm/CDN or placed in asset URLs.
Fetched viewer code can read the page's data, and asset requests disclose ordinary
network metadata. Pinning and integrity constrain runtime changes; they do not
isolate the viewer from the tour. No telemetry, remote source loading, or automatic
website previews are part of CDN delivery. Once verified assets and data are in
memory, reading and diff interaction should need no further network requests.

Test unpublished versions, blocked CDN, corrupt assets, denied storage, and an
unavailable worker. Do not present untested publication/CORS behavior as complete.
Archive-oriented users should choose the embedded option; internet acceptance
does not change the pinned identity or evidence guarantees of either profile.

## Export flow and relationship to deep links

Proposed CLI surface, not an existing command:

```text
bygone tour export review.bygone --format html --output review.html
bygone tour export review.bygone --format html --profile full --output review-full.html
```

Proposed advanced options: `--runtime cdn|embedded` and an exact
`--runtime-version`. Recommend Minimal with a compatible pinned CDN viewer by
default. Reject unsupported schema/runtime combinations before writing output.

Desktop can expose “Export tour as HTML…” using the same materializer. Recompile
saved authored source and show the chosen snapshot; never imply unsaved editor
state was included. An explicit future “export currently loaded snapshot” action
can preserve exactly that compiled state if needed. Validate and write to a
temporary file, then replace the selected output atomically with overwrite
handling. Exporting creates a local artifact; it does not publish or upload it.

Use URL fragments for in-export title/chapter/scene/step/review-note focus and
mode/file/revision focus, adapting the semantic document and evidence targets
from [deep-linking.md](deep-linking.md). Document links reveal the prose section,
not just its associated code comparison. Browser back/forward
should follow deliberate navigation without recording every scroll. Hosted
exports gain shareable fragment links; a local file URL still depends on the
recipient's path. Offer “Copy location within this export” without claiming
that it distributes the HTML itself.

Native links can later use export identity or repository provenance for a
deliberate “Open in Bygone” action. The export must remain fully usable without
that feature and must not require a local repository to follow its own links.
Changing scope or evidence creates a new content identity; a missing target
should be reported explicitly rather than redirected to the first scene.

## Delivery and verification gates

1. **Compatibility spike:** package one walkthrough, one real stack, and one
   deconstructed multi-file tour into single HTML files. Prove worker startup,
   fonts, focus/connections, navigation, and read-only behavior on disk in the
   three desktop browsers. Stop before building export UI if this contract fails.
2. **Materializer and capabilities:** enumerate the evidence dependency graph,
   deduplicate, remove local bindings, validate anchors, declare omissions, and
   adapt the host's data access and mode controls. Preserve existing web/desktop
   behavior and manifest v1/v2/v3 compatibility.
3. **Product export:** shared CLI/desktop flow, preflight, safe writer, export
   details, fragment navigation, scoped search, and helpful failure states.
4. **Full profile:** compare indexed Git-derived and native-object packaging,
   then validate bounded history/comparison parity and size before exposing Full.

The viewer delivery work belongs in the compatibility/materializer slices:
publish a browser entry point with asset manifest, validate exact version and
integrity/CORS behavior, and exercise built-in network-failure messages before
shipping the recommended CDN default. Embedded export reuses the same viewer.

Acceptance includes moving the file to an empty directory/machine with no repo,
stopping Bygone and its server, blocking network access and asserting zero
HTTP(S) requests while reading an Embedded export, then testing every exposed
control. For CDN delivery, allow only pinned viewer requests, verify no tour-data
requests, and test startup without internet for a useful failure screen. Test
external links as explicit online actions. Cover denied storage/clipboard,
worker failure, corrupt payloads, source with script-closing text, huge files,
omissions, renames/deletions, virtual panels, all authored modes, review notes,
search coverage, keyboard navigation, deep fragments, and runtime license notices.

Confidence is high that a snapshot export fits the current compiled-tour model.
Confidence is moderate in single-file browser parity and large-tour performance
until the compatibility spike passes; failed Blob worker/CSP behavior or excessive
memory use would change the runtime packaging recommendation. Git-history parity
outside the declared scope is not promised. Confidence is high in npm/CDN asset
delivery in principle; the export entry point, CORS/workers, integrity handling,
and published release contents remain untested.

Source inspection, bundle measurement, and browser API documentation informed
this scope. No exporter was implemented, no browser prototype or runtime tests
were run, and no rebuild/install was needed for this planning-only change.
