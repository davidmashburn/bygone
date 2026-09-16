# File-change overview and review entry-point

## Status

Implemented through Phase 3 on `feat/file-change-overview` by `620f660`.

The implementation adds the shared versioned attention model, a generated
Present overview scene, and an Explore branch-review Overview/Files landing.
Authored tour order and the complete changed-file inventory remain unchanged.
Phase 4 agent-context JSON remains optional and was not included.

## Goal

When someone opens a branch change, they should first see a **file-change
overview** rather than an alphabetically first file or a tree of every path.

The overview must answer three questions immediately:

1. **Where do I start?** One review entry-point file, with a short inspectable
   reason.
2. **What deserves attention?** A small ranked set of files that likely change
   the reviewer's conclusion.
3. **What can wait?** Files that are usually noise for a first pass: lockfiles,
   generated artifacts, maps, binaries, and often tests or packaging unless
   they *are* the change.

The complete changed-file set stays reachable. Ranking and grouping are
progressive disclosure, not a second incomplete inventory.

## Context

This is the first-pass slice of the older “deterministic change triage”
idea: make a change legible before asking anyone to walk every path.

### What people do today

- **Git → Review Branch Change** / `bygone review` opens the merge-base-to-tip
  inventory as a directory comparison. The first clickable file is whatever
  the tree lists first, not a recommended start. Session “viewed” markers only
  mean visited, not important.
- **Present Current Branch** / `bygone present` builds a generated tour whose
  scenes are grouped by coarse path chapters (`context`, `contracts`,
  `behavior`, `proof`, `packaging`) and then sorted by path. The first scene is
  therefore “first architecture-ish filename,” not an entry-point. The Files
  rail already keeps omitted binaries and oversized files visible with a
  reason.
- **Authored tours** can already lead with contracts and defer lockfiles in
  narrative, but that help only exists after someone writes `.bygone`.
- **`bygone tour context`** already classifies files as `production`, `test`,
  `documentation`, `dependency`, or `generated` and omits lockfile/binary
  patches from LLM dossiers. Humans opening Explore or Present do not see
  that classification.

### Current code seams (on `main`)

These should be reused, not duplicated:

| Seam | Today | Gap |
| --- | --- | --- |
| `classifyFileRole` in `src/changeTourContext.ts` | Path heuristics for agent context | Unused by Explore and Present UI |
| `chapterForPath` in `src/changeTour.ts` | Parallel, slightly different path rules for generated scenes | Two classifiers for one idea |
| Change inventory (`src/changeInventory.ts`) | Per-file units, additions/deletions, material | No attention rank or entry-point |
| Generated tour files rail | Complete list plus omission reasons | No start-here or skip grouping |
| Branch review directory view | Full tree, rename pairing, viewed counts | No overview surface |
| Tour coverage exclusions | Author-declared skip-with-reason | Not applied to unauthored first look |

A useful first release is a **shared, deterministic attention model** consumed
by Explore, generated Present, and optionally CLI/agent context—not a new
review checklist and not an LLM-authored summary.

## User-facing behavior

### When the overview appears

Show the overview as the **initial scene** of:

- Explore branch review (`Git → Review Branch Change`, `bygone review`);
- generated Present (`Present Current Branch`, `bygone present` without
  `--tour`).

Do not insert it in front of an authored `.bygone` tour. Authored narrative
already chooses its own start. The Files rail in an authored tour can still
show attention badges as a later, optional enhancement.

Opening a specific file from history, search, or a deep link skips the
overview and goes to that file.

### What the overview contains

A single read-only panel (Explore) or generated first scene (Present) with:

1. **Change size.** File count, textual vs binary, `+`/`−` lines, commit
   count. Reuse existing branch-review summary numbers.
2. **Start here.** Exactly one path, or an explicit “no single entry-point”
   state when the change is a pure mechanical/lockfile/test sweep. Include a
   one-line reason such as “shared contract used by 4 other changed files” or
   “only production file in this range.”
3. **Pay attention.** Three to seven paths after the entry-point. Production
   and contract files first; include a test only when it is the primary proof
   of a behavior change or the only substantial textual change. Each row shows
   change kind and `+`/`−`.
4. **Usually skip.** Grouped, collapsed by default: lockfiles and other
   `dependency` paths, `generated` paths, binaries/maps, then tests and docs
   unless already listed under attention. Show counts, not every lockfile
   hunk. Expanding a group lists the paths; clicking still opens the real
   diff. Never drop a path from the complete inventory.
5. **Primary action.** Open the entry-point comparison (Explore) or advance
   to that file’s generated scene (Present). Secondary: “Show all files” /
   jump to the Files rail or directory tree.

Keyboard: Enter or the existing next-change control leaves the overview for
the entry-point. Escape is not required; the overview is not a modal.

### Language

Use **start here**, **pay attention**, and **usually skip**—not “reviewed,”
“approved,” or “ignored.” Skipping is a reading order hint. The Files rail
and directory tree remain the source of truth for what changed.

If the heuristic is wrong, the user must be able to open any other file in
one click. Do not hide skip-group files behind a setting in the first
release.

## Attention model

### Shared classifier

Replace the two path taxonomies with one exported module, for example
`src/changeAttention.ts`, used by tour context, generated tours, and the
overview.

Keep the existing role names unless a rename is forced:

- `production`
- `test`
- `documentation`
- `dependency` (manifests and lockfiles)
- `generated` (build output, vendor, minified, source maps)

Add a separate **attention class** so tests are not forced into “skip”:

| Attention class | Default membership | User-facing group |
| --- | --- | --- |
| `entry` | At most one file | Start here |
| `focus` | Small production/contract set | Pay attention |
| `background` | Remaining tests, docs, packaging manifests | Usually skip (expandable) |
| `mechanical` | Lockfiles, generated, binaries, maps | Usually skip (collapsed) |

Roles stay factual. Attention class is the ranked overlay.

Tighten lockfile detection relative to today’s `*.lock` regex so
`Cargo.lock` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` /
`poetry.lock` / `Gemfile.lock` / `composer.lock` count as mechanical, while
an application file named `feature.lock` is not silently dropped into
packaging. Manifests (`package.json`, `go.mod`, `Cargo.toml`) stay
`dependency` but are `background` unless they are the only production-shaped
change (version bump only → mechanical/background; new dependency that other
files import → focus).

### Entry-point selection (deterministic)

Compute a score for each textual, non-mechanical file and pick the maximum.
Ties break by (1) more changed files that likely depend on this path, (2)
fewer lines changed (prefer a small contract over a huge dump), (3)
localeCompare path.

Signals, all inspectable in tests and in the overview reason string:

1. **Role.** Production beats documentation beats test. Mechanical files
   cannot win.
2. **Fan-in from this change set.** Count other changed files whose head
   text mentions the entry candidate’s basename or exported symbol hints
   already produced by `changeTourContext`. This is a bounded string/symbol
   hint, not a language-server graph. Document that it is a hint.
3. **Contract-shaped paths.** `types`, `schema`, `model`, `contract`,
   `interface` in the path or filename, matching the current generated-tour
   chapter bias.
4. **Commit concentration.** Files touched by more commits in the range are
   slightly preferred when fan-in is tied.
5. **Not a barrel or dump.** Penalize generated-looking size (huge `+`/`−`
   with no symbol hints), `dist/`, `.map`, and minified names even if role
   classification missed them.

Do **not** pick:

- the largest diff by default;
- `README.md` unless it is the only textual file;
- the alphabetically first `src/` file.

When every textual file is mechanical or test-only, entry-point is empty and
the overview says the change is packaging, generated, or test-only, with the
largest non-binary file as a fallback “if you still want a diff.”

### Pay-attention list

After choosing the entry-point:

- Take remaining `production` files ordered by the same score, capped at
  seven including the entry-point.
- Insert at most one test file if a production file in the focus set has a
  same-stem or path-adjacent spec (`foo.ts` / `foo.test.ts`) with substantial
  hunks.
- Exclude mechanical files.
- If more than seven production files remain, they stay in the complete list
  and directory tree; the overview says “N more production files.”

### Stability

The model is a pure function of the resolved Git range (OIDs, name-status,
numstat, bounded head snippets for fan-in). Same OIDs ⇒ same overview. Dirty
worktree stays excluded from the committed range, consistent with branch
review.

Version the attention result (`CHANGE_ATTENTION_VERSION`) next to inventory
and tour-context versions so CLI JSON and UI can evolve.

## Product surfaces

### Explore

Add an overview state to branch review before any file comparison is shown.

- Directory columns remain available via “Show all files” or a tab/segment
  control: **Overview | Files**.
- Default landing: Overview.
- Selecting a path from either view opens the existing file pair; returning
  to the directory does not destroy viewed-path state.
- Overview rows that match skip groups use quieter styling but remain
  activatable.

Do not add checkboxes or persist “skipped” as review state.

### Generated Present

Insert a generated `overview` scene as `scenes[0]` for automatic tours only.

- Chapter rail: a first chapter such as “Start here” containing only the
  overview scene, then existing path-based chapters.
- Next from overview focuses the entry-point file scene (or the first
  remaining generated scene if there is no entry-point).
- Files rail: optional attention markers (start-here, focus, skip) that do
  not remove omitted-file rows or their reasons.
- Authored tours: no automatic overview scene.

Schema: add an overview scene kind or a dedicated first-scene payload so the
presenter does not pretend the overview is a text-diff of a fake path.

### CLI and agents

- `bygone review` and `bygone present` pick up the same landing behavior when
  they open UI.
- Add JSON on the existing context command or a small sibling, e.g. include
  `attention: { entryPath, focus[], mechanical[], reasons[] }` in
  `bygone tour context` so tour-generation skills can lead with the same
  start file humans see.
- A `--json` overview dump is useful for tests; do not add a separate
  user-facing CLI product mode.

## Proposed implementation sequence

### Phase 1: Shared attention module and tests

- Extract and unify role classification.
- Implement scoring, grouping, and reason strings.
- Fixtures: mixed production+lockfile+tests; lockfile-only; single-file
  production; many peers with one shared types file; rename pairs; binary +
  map omissions.
- Golden tests for reason strings so copy does not drift.

### Phase 2: Generated Present landing

- Overview as first generated scene.
- Next/previous, URL restoration, and Files-rail badges.
- Keep complete file list and omission reasons.

This is the smallest user-visible win: Present already has a scene model and
a files rail.

### Phase 3: Explore branch-review landing

- Overview | Files in the directory session.
- Open entry-point from the overview using the existing review path pair.
- Desktop and CLI `review` launch contracts; VS Code hand-off continues to
  open desktop rather than growing a companion overview.

### Phase 4: Context JSON for agents

- Expose the same structure from `bygone tour context`.
- Point the pr-tour-guide / generating-change-tours docs at “start here”
  instead of asking the model to rediscover importance from a flat file list.

Stop after Phase 3 unless agent authoring is in the same slice. Phase 4 is
small once the module exists.

## Scope and non-goals

**In scope**

- Deterministic overview for unauthored branch changes.
- One entry-point plus attention vs skip grouping.
- Shared classifier used by Present and Explore.
- Complete inventory still visible.

**Out of scope for this plan**

- LLM-written summaries, chapter titles, or “why this PR exists.”
- Persistent review ledgers, GitHub/GitLab review sync, or approval state.
- Replacing authored tour order.
- Language-server or precise import graphs.
- Auto-collapsing skip files inside the directory tree as the only view
  (tree remains complete).
- Treating tests as always ignorable; they default to background, not
  mechanical.
- Coverage-percentage gates.

## Risks and decisions

1. **Wrong entry-point is worse than none.** Prefer an honest “no single
   start file” over a confident bad pick. Show reasons; keep one-click
   override.
2. **Two classifiers already disagree** (`chapterForPath` vs
   `classifyFileRole`). Unifying them will change generated-tour chapter
   assignment for some paths. Accept that as part of Phase 1 and snapshot
   current Bygone self-tours if their scene order shifts.
3. **Fan-in via substring hints will false-positive** (`util.ts`). Mitigate
   with symbol hints, path uniqueness, and tests; never require a parser.
4. **Large monorepo ranges.** Scoring must use already-bounded snippets (tour
   context budgets), not full-tree reads. Cap fan-in sources.
5. **Product vocabulary.** “Usually skip” must not be read as “safe to ignore
   in production.” Copy should stay about first-pass reading.
6. **Host ownership.** Overview belongs in standalone Explore and Present.
   VS Code only hands off.

## Acceptance criteria

- Opening an unauthored branch review or generated present starts on the
  overview, not on an arbitrary first file.
- A mixed change (production + tests + lockfile) names a production
  entry-point, lists other production files under attention, and groups the
  lockfile under usually-skip.
- A lockfile-only change does not invent a fake architectural start file.
- Every changed path remains reachable from the Files rail or directory
  tree; skip groups never omit paths.
- Same merge-base and head OIDs produce the same overview JSON.
- Authored `bygone present --tour` is unchanged in scene order.
- Existing “viewed” semantics stay “visited this session,” not importance.

## Next steps

1. Land Phase 1 on `main` with fixtures and a versioned attention JSON
   helper.
2. Land Phase 2 on generated Present; verify with Bygone’s own history range
   and a lockfile-heavy fixture.
3. Land Phase 3 on Explore branch review; update `docs/explore.md`,
   `docs/present.md`, and `docs/product-surface.md`.
4. Optionally extend `bygone tour context` and tour-generation docs (Phase 4).

Related: generated-tour chapters in `src/changeTour.ts`, file roles in
`src/changeTourContext.ts`, complete Files rail behavior in Present, and the
historical triage notes on `main` under `docs/change-explanation-plan.md`.
This plan is the executable slice; it does not revive the broader explanation
roadmap.
