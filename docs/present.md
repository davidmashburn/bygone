# Present changes with Bygone

Present is the guided-reading surface. It combines narrative scenes with exact
source evidence while keeping the complete changed-file set available.

## Generated and authored tours

- **Present Current Branch** or `bygone present` generates a deterministic
  reading order for the committed merge-base-to-tip range. It begins with a
  change overview that reports range size, recommends a **Start here** file when
  the evidence supports one, and separates **Pay attention** from **Usually
  skip** first-pass reading hints. Continue through the reading flow to reach
  the recommended file.
- **Open Authored Tour…** or `bygone present --tour path.bygone` opens a
  narrative whose anchors have been compiled to exact source locations.

The left navigator switches directly among **Tour**, **Files**, and **Commits**;
only one of those lists is visible at a time. The Tour outline has independently
collapsible chapters and scenes; selecting a title jumps to that reading stop
without changing which sections are expanded.

The reading panel flows continuously through the tour title, chapters, scene
overviews, and steps. Scroll the narrative or use keyboard navigation to move
through that order; the corresponding code evidence follows. Scrolling the code
does not advance the narrative. Each scene overview is a distinct stop with its
supporting points and takeaway. Each step keeps a collapsed **Scene context**
disclosure above its title and explanation. Expanding that disclosure does not
move the reading position.

A direct link to a step opens that step immediately. The header reports the
current position as `Scene N of M · Step N of M`, or identifies the overview.
The reading panel scrolls within a bounded area above the evidence; no Start,
Resume, or Previous/Next buttons interrupt the flow. Returning from History or
Compare restores the tour's saved reading position. On narrow screens, the
navigator becomes an overlay instead of stacking another permanent region
above the diff.

The code view uses the available width for an added or deleted file when only
one side is present. An empty **Present** view keeps the regular split layout.
When the current step has an exact source target, **Show in code** refocuses the
corresponding file and line.

Choose **Files** in the navigator to browse the complete change set without
changing the active tour position. While reading a step, browsing another file
keeps the active tour anchor visible; **Return to Tour** restores the scene's
intended focus. While a directory **Overview** is active, files open in its
comparison and files outside that comparison are disabled. Opening a file keeps
the overview text and reading position. Select **Overview** above the diff to
return to the tree, or continue through the narrative to the next step.

**Tour details** is available on demand and contains the source link, range,
change counts, and authored diff-hunk coverage. Coverage describes how much
code the author anchored; it does not measure your reading progress. The
header shows your current step. Tour search is likewise disclosed on demand or
opened by `Cmd/Ctrl+Shift+F`.

Generated overview ranking is deterministic for the resolved Git object IDs.
It never hides files and does not invent an entry point for a test-only,
lockfile-only, binary, or generated-only change. Authored tours keep their
authored first scene and order.

For desktop section links and portable Minimal/Full HTML snapshots, see
[Links and portable HTML tours](sharing-tours.md).

Opening a version 1, 2, or 3 authored tour in Desktop offers **Convert and open
copy** by default. This saves a v4 copy beside the original (for example,
`demo.v4.bygone`) without overwriting either the original or an existing copy.
Cancel leaves the current view unchanged. The same offer appears when selecting
a tour for HTML export; browser uploads ask before converting and download a copy
after opening it.

Conversion preserves authored IDs and revision references, so section links keep
their targets. Review notes become a **Legacy review notes** appendix in the last
authored step or stage of each available tour. The appendix includes readable notes,
recorded revision IDs, evidence references, and next checks. Unrecognized review
fields are retained verbatim in the flow. Resolvable walkthrough references link back to their steps. The notes
are labeled as imported, not revalidated against potentially moving branches.
YAML comments and formatting are not copied. Conversion
stops with a specific validation error if the tour needs manual changes, such as
a v1 synthetic-only root scene without the real revision evidence required in v4.
Noninteractive CLI validation and compilation continue to require a supported
source; open retired v3 sources in Desktop to convert them first.

## Explore and follow tours

Version 2 and 4 presentations expose **History**, **Compare**, and the available
authored tours as direct mode buttons.
Independent Historical and Deconstructed tours require version 4:

- **History** uses all commits reachable from the presentation's head, in stable
  topological order, including commits that did not change the current file.
  Left/right moves through commits; up/down moves through the Files list without
  changing the loaded revisions. History starts with a commit and the preceding
  commit on this axis (or the empty tree). Panel `+` controls expand into
  older or newer revisions; `×` removes a panel, with a minimum of two. Returning
  from Compare restores the expanded History workspace. Activating a loaded
  revision focuses its panel; another revision moves the history window while
  retaining its panel count where older history is available. Shortcuts compare
  the active revision with its parent or the review base.
- **Compare** shows one panel per selected revision, oldest to newest, with a
  diff between each adjacent pair. The Commit navigator remains available for
  editing a draft selection; **Update comparison** applies it. Activating a loaded revision focuses its
  panel. **Compare selected** includes all changed files. Parent/base shortcuts
  stay on the current file; **Show all changed files** expands the same range.
  **Final diff** selects the review base
  and head across all changed files.

All modes share the expanded **Commits** navigator. Check two or more revisions,
then choose **Compare selected** (or **Update comparison** in Compare).
Checkboxes edit a shared draft without reloading panels or leaving the tour.
Numbered badges and highlights identify loaded real revisions independently of
that draft. A dot marks commits that changed the current file, following renames;
the **Tour** tag identifies commits in the authored range. Synthetic explanation
stages are not labeled as Git revisions. Parent/base revisions outside the
commit list appear as labeled extra rows.
**Clear selection** unchecks draft revisions without changing modes or panels;
**Reset selection** selects the real revisions currently loaded in the workspace.

- **Historical tour** explains actual revision states, including intermediate
  changes, updates, and reverts. It retains chapters, scenes, steps, and narration.
- **Deconstructed tour** explains the change through authored, synthetic
  cumulative stages. Its panels are explanation stages, not Git commits.

Previously compiled version 2 deconstructed tours retain their separate
authored **Final tour** alongside the synthetic stages. Existing `mode=final`
links open that walkthrough; other final-diff links open Compare at the review
endpoints.

Only available authored tours appear. A real revision stack does not by itself
create a Historical tour. Each mode remembers its own reading or browsing
position and navigator tab during the session; entering a tour for the first time starts at its
beginning. Entering History for the first time keeps the file currently being
inspected; later returns restore History's own file and revision. Switching
modes does not infer a corresponding step in another tour.
The active tour position or comparison is also reflected in the URL for refresh.

While reading a step, expand **Scene context** beneath it to keep the scene's
summary, supporting points, and takeaway visible without leaving the step.

## Listen to a tour

Use **Listen** beside the reading breadcrumb or **Present → Listen to Tour** in the
desktop app to read the tour aloud with a device voice. Narration works
offline and does not send tour text to a hosted speech service.

Narration controls are available from **‹ Narration** beside the reading
breadcrumb, with sentence navigation, Stop, voice, and speed. Use the
right-edge chevron to collapse them again. Listen becomes Pause or Resume
during playback. The overview opens when its
text is spoken so the highlighted sentence remains visible.

- **Pause/Resume** retains the current sentence; **Stop** clears playback. The
  outer jump controls move one sentence backward or forward within the current
  narration item.
- Existing Previous and Next controls move through the same scene/step order
  used by continuous narration.
- Choose any device voice exposed by the browser and a speed from 0.75× to
  1.5×. Bygone stores those preferences locally and returns to the system
  default if a selected voice disappears.
- The visible sentence is highlighted while it is spoken. Pausing retains a
  distinct paused highlight without moving keyboard focus.
- Direct scene, file, or search navigation interrupts speech and leaves it
  paused at the selected tour position. Resume continues from there.

Automatic narration reads chapter and scene framing, summaries, bullets,
step titles and bodies, connection labels, and takeaways. It does not
automatically read diff contents, code blocks, hashes, line numbers, or raw
URLs. Those remain visible and available to assistive technology normally.

Device voice names and quality depend on the operating system and browser.
If no device speech engine is exposed, Bygone disables Listen with a specific
unsupported-device message; lack of network access alone never disables it.

Future narration work may add opt-in treatment for code and raw URLs, plus
higher-quality hosted voices or routing through the agent that originated the
conversation. Those remain separate from the offline, device-first baseline.

## Read provenance correctly

- Normal walkthrough scenes point to exact committed source evidence.
- A stacked-diff panel represents a real revision and retains its Git identity.
- A deconstructed-diff panel is an **Explanation stage** assembled from exact
  change units. It is synthetic and must not be described as a real commit.

Tour content is read-only. Author or revise the YAML and recompile it rather
than editing historical or synthetic panels in the presenter.

Scene and step narrative explain the implemented change, concepts, boundaries,
and tradeoffs beside their evidence. Label unresolved questions explicitly and
state the next check that would resolve them.

## Authoring workflow

Use the CLI or the repository's tour-generation skill:

```bash
bygone tour context HEAD --base origin/main
bygone tour validate tour.bygone --json
bygone tour compile tour.bygone --output tour.json
bygone tour schema
```

See [the change tour format](./change-tour-format.md) and
[LLM-assisted generation](./generating-change-tours.md) for the complete
contract. Checked-in examples include real stacked revisions and explicitly
synthetic deconstructed stages.

### Directory evidence in an Overview

In version 4, an authored scene can show a directory comparison in its Overview. Open a file
to inspect the same comparison while keeping the overview text, narration, and
reading position. The **Overview** breadcrumb returns to its file tree;
scroll through the narrative or select a step in the outline to continue the
authored explanation.

Stacked and Deconstructed scenes use a stable comparison: by default, the first
and last scene panels, or explicit endpoints chosen by the author. Moving between
steps never changes this comparison. The column labels identify its endpoints.
Their overviews include only files materialized in the scene panels.
Walkthrough scenes use the review's base-to-head comparison and the tour files,
retaining omitted-file entries. Any scene type can limit the overview to a
subdirectory. While browsing a file, `Overview › file path` shows where you are,
with a reminder that narration still describes the overview.

## Screenshot evidence

A walkthrough step can display a committed PNG in place of its code comparison:

```yaml
- id: compare-window
  title: Read the comparison
  body: Blue regions pair corresponding changes across the gutter.
  focus: guide-paragraph
  image:
    file: docs/images/comparison.png
    revision: head
    alt: Two code panes with blue paired changes and green additions.
```

The required `focus` still anchors the explanation to text in the tour's Git
range. `image.revision` selects the comparison's merge base (`base`) or head
(`head`). Compilation reads that Git blob, ignoring working-tree edits, and
embeds its bytes in the manifest and HTML exports. Use repository-relative paths
and meaningful alt text. PNGs are limited to 8 MiB, 16,384 pixels per dimension,
and 64 megapixels. **Expand image** opens an enlarged view; Escape closes it.
Returning to a code step, file, or comparison restores the regular workspace.

Tours made entirely of image steps start on their first image. Their title,
chapter, and scene headings remain in the reading document, but Next/Previous
visits only image steps. Selecting a heading displays its first image instead
of an automatic directory overview. Mixed code/image tours retain the usual
overview navigation.

See the [visual walkthrough](visual-walkthrough/README.md) for a complete example.
