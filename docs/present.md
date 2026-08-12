# Present changes with Bygone

Present is the guided-reading surface. It combines narrative scenes with exact
source evidence while keeping the complete changed-file set available.

## Generated and authored tours

- **Present Current Branch** or `bygone present` generates a deterministic
  reading order for the committed merge-base-to-tip range.
- **Open Authored Tour…** or `bygone present --tour path.bygone.yaml` opens a
  narrative whose anchors have been compiled to exact source locations.

The Files rail is independent of the narrative. Browsing another file keeps
the active tour anchor visible and offers **Return to Tour** to restore the
scene's intended focus.

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
bygone tour validate tour.bygone.yaml --json
bygone tour compile tour.bygone.yaml --output tour.json
bygone tour schema
```

See [the change tour format](./change-tour-format.md) and
[LLM-assisted generation](./generating-change-tours.md) for the complete
contract. Checked-in examples include real stacked revisions and explicitly
synthetic deconstructed stages.
