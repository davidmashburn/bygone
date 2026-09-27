# Present changes with Bygone

Present is the guided-reading surface. It combines narrative scenes with exact
source evidence while keeping the complete changed-file set available.

## Generated and authored tours

- **Present Current Branch** or `bygone present` generates a deterministic
  reading order for the committed merge-base-to-tip range. It begins with a
  change overview that reports range size, recommends a **Start here** file when
  the evidence supports one, and separates **Pay attention** from **Usually
  skip** first-pass reading hints. Next advances to the recommended file.
- **Open Authored Tour…** or `bygone present --tour path.bygone` opens a
  narrative whose anchors have been compiled to exact source locations.

The active scene expands into named, selectable steps in the outline. The
current step's title and explanation lead the reading panel; put the
evidence-grounded rationale and tradeoffs for that code beside it in the step
body. The reading breadcrumb follows **Tour → Chapter → Scene → Step**, using
actual titles and omitting redundant single-child levels. Select a parent to
browse its children; select the scene title for its supporting points and
takeaway. **Resume step N** returns to your reading position, which survives
refreshing a parent view. The breadcrumb and Previous/Next stay visible while
long explanations scroll. Scenes without steps show their narrative directly.

When you enter a stepped scene from the outline, the reading area starts with a
full scene overview, including its bullets, tags, and takeaway. Choose **Start
steps** to open the first step; a direct link that includes a step opens that
step immediately. The header reports the current position as `Scene N of M ·
Step N of M`, and the final navigation control is **End of tour**. The reading
area uses the available width beside the sidebar and fills the viewport on
narrow screens above the diff.

The code view uses the available width for an added or deleted file when only
one side is present. An empty **Present** view keeps the regular split layout.
When the current step has an exact source target, **Show in code** refocuses the
corresponding file and line.

Expand **Files** at the bottom of the sidebar to browse all changed files.
The Files rail is independent of the narrative. Browsing another file keeps
the active tour anchor visible and offers **Return to Tour** to restore the
scene's intended focus.

**Tour details** contains the source link, range, change counts, and authored
diff-hunk coverage. Coverage describes how much code the author anchored; it
does not measure your reading progress. The header shows your current step.

Generated overview ranking is deterministic for the resolved Git object IDs.
It never hides files and does not invent an entry point for a test-only,
lockfile-only, binary, or generated-only change. Authored tours keep their
authored first scene and order.

## Explore and follow tours

Version 2 and 3 presentations group the mode switcher into **Explore** and **Tours**.
Independent Historical and Deconstructed tours require version 3:

- **History** browses a file's actual Git revisions. Select a revision, choose
  **Compare from here**, then select another revision and choose **Compare to
  here**. Shortcuts compare with the parent or review base.
- **Compare** shows a plain two-way diff between the selected revisions.
  Change either endpoint or swap their order. Comparisons opened from file
  history stay on that file; **Show all changed files** expands the same range.
  **Final diff** selects the review base and head across all changed files.
- **Historical tour** explains actual revision states, including intermediate
  changes, updates, and reverts. It retains chapters, scenes, steps, and narration.
- **Deconstructed tour** explains the change through authored, synthetic
  cumulative stages. Its panels are explanation stages, not Git commits.

Only available authored tours appear. A real revision stack does not by itself
create a Historical tour. Each mode remembers its own reading or browsing
position during the session; entering a tour for the first time starts at its
beginning. Switching modes does not infer a corresponding step in another tour.
The active tour position or comparison is also reflected in the URL for refresh.

## Listen to a tour

Use **Listen** beside the reading breadcrumb or **Present → Listen to Tour** in the
desktop app to read the tour aloud with a device voice. Narration works
offline and does not send tour text to a hosted speech service.

Narration controls appear beside the reading breadcrumb by default,
with sentence navigation, Stop, voice, and speed. Use the right-edge chevron to
hide them, and **‹ Narration** to bring them back. Listen becomes Pause or Resume during playback. The overview opens when its
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

Version 3 authored tours may expose a separate, read-only **Review notes** panel
for evidence-linked concepts, boundaries, tradeoffs, and open questions. Scene
and step narrative should still explain the implemented change and the tradeoffs
supported by its evidence.

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

In version 3, an authored scene can show a directory comparison in its Overview. Open a file
to inspect the same comparison while keeping the overview text, narration, and
reading position. The **Overview** breadcrumb returns to its file tree; **Start steps**
or **Resume step** follows the authored explanation.

Historical and Deconstructed scenes use a stable comparison: by default, the
first and last scene panels, or explicit endpoints chosen by the author. Moving
between steps never changes this comparison. The column labels identify its endpoints. Walkthrough scenes use
the review's base-to-head comparison. Authors can limit the overview to a
subdirectory; unavailable file contents remain marked as omitted. While browsing
a file, `Overview › file path` shows where you are, with a reminder that narration
still describes the overview.
