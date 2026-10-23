# RefModel-style prompt experiment

This tests the prompt architecture, not the paper's published model scores.
Upstream [RefModel](https://github.com/brain-ufcg/RefModel) is pinned to
`82f35b406c77e7ce18a0cf7739dc135e76fb3c44`. Its `build_template` function is
loaded in isolation from an external cached source file. The upstream CLI,
imports, server setup, and package installation are not executed. Upstream
source and definitions are not vendored here.

`protocol.json` froze the original 32 cases, two arms, hashes, model, budgets,
expected labels, and manual questions before inference. It is retained intact.
`codex-protocol.json` records the subsequent user-requested substitution of
authenticated Codex, with the same task prompts and a shared no-tools wrapper.
Existing results were inspected before this substitution; it is a diagnostic
replication, not a fresh held-out comparison of models. Both model aliases can
change. These reports are not immutable model-checkpoint benchmarks.

The plain arm uses the original 19 English definitions and before/after source
or diff. The grounded arm adds the existing independent inventory and engine
correspondence hints, requests exact citations, separates additional edits,
and explicitly permits uncertainty. This changes both evidence and prompting;
the experiment cannot attribute a difference to one component alone.

Gold labels/manual questions are never sent in task prompts. The frozen
`evidence.json` contains detector observations, not adjudicated truth. Both
arms receive identical source scope: complete snapshots up to 24,000 combined
characters, otherwise a unified diff with three context lines. No other
repository files or git history are intentionally provided. The Codex harness
adds its own context and default sampling; it is not the raw model API.

## Reproduction

Obtain `RefModel/RefModel.py` and
`RefModel/definitions/refactoring_definitions.txt` at the pinned revision in an
external cache. Their hashes must match the protocol. Existing ChatGPT Codex
authentication is reused; no API key or login material is copied into reports.

```sh
python3 scripts/change-analysis/refmodel/run-codex.py \
  /path/to/RefModel.py /path/to/refactoring_definitions.txt
node scripts/change-analysis/refmodel/score-reports.js \
  scripts/change-analysis/results/refmodel-codex-2026-10-22.json
node --test scripts/change-analysis/refmodel/*.test.js
```

The runner creates 64 fresh ephemeral CLI sessions, four at a time, uses an
empty temporary working directory, ignores user configuration, and requests no
tools. Any completed tool item invalidates that response. It retains final
answers and usage, not internal reasoning. Timeout is 240 seconds per session;
no retries or JSON-schema enforcement. Provider-side infrastructure can still
retry internally. Completed reports are overwritten on rerun, so save a
separate copy first. `make-evidence.js` regenerates the frozen hints from the
mapping reports; doing so changes its hash and requires a new protocol.

`run-refmodel.py` retains reproduction of the preliminary GPT-OSS/Ollama pass;
the subsequent evaluation follows the user's GPT/Codex preference.

## Interpretation

`validate-output.js` rejects malformed JSON, wrong IDs, invented/nonunique
quotes, citations outside a symbol, paths outside scope, excessive output
arrays, noncatalog labels, and an asserted behavior result. A source-valid
proposal is still an inference. Mapping support does not prove that an
operation happened, nor that its behavior was preserved. An invalid report is
rejected as a whole; individual valid portions are not silently salvaged.

`score-reports.js` performs source checks and extracts bold upstream bullet
headings. Its label list is an aid for inspection, not an exhaustive semantic
parser of prose. The findings require manual reading of the raw answers.

The original score contract has known limitations, retained rather than
edited after inference: `Move Class` and `Extract Method` are absent from the
upstream catalog; `Move Method` describes class members whereas most fixtures
move module-level functions; whole-file relocation has no dedicated label.
The history-01 overload can reasonably be described as adding a parameter
overload even though the frozen expected-label list is empty. Ambiguous
origins and wholesale rewrites permit multiple plausible histories. Report
these separately instead of publishing a single misleading precision/recall.

See [findings](../refmodel-findings.md) and the raw/scored reports in
`../results/`. No product integration, reviewer-benefit study, independent
adjudication, repeated-seed test, or broad accuracy benchmark was performed.
