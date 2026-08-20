# Present changes with Bygone

Present is the guided-reading surface. It combines narrative scenes with exact
source evidence while keeping the complete changed-file set available.

## Generated and authored tours

- **Present Current Branch** or `bygone present` generates a deterministic
  reading order for the committed merge-base-to-tip range.
- **Open Authored Tour…** or `bygone present --tour path.bygone` opens a
  narrative whose anchors have been compiled to exact source locations.

The Files rail is independent of the narrative. Browsing another file keeps
the active tour anchor visible and offers **Return to Tour** to restore the
scene's intended focus.

## Listen to a tour

Use **Listen** in the narrative header or **Present → Listen to Tour** in the
desktop app to read the tour aloud with a device voice. Narration works
offline and does not send tour text to a hosted speech service.

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
