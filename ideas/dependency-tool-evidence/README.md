# Synthetic tool probes, 2026-10-27

Companion evidence for [the evaluation](../dependency-graph-tools.md). These are
research fixtures and captured outputs, not shipped Bygone code or a complete
accuracy benchmark. Absolute `/tmp` paths in captured output identify the original
run; they are not dependencies for reproduction. Timings vary on rerun.

- `fixtures/`: TypeScript, Python and Go inputs; `fixture-inputs.json` duplicates
  their exact original contents for an easy single-file audit.
- `minimal/`: reduced Python shadowing and TS dynamic-import cases.
- `*-default.json`, `*-references.json`, `*-minimal.json`: cgg 0.11.2 outputs.
- `ts-native.cjs`, `ts-native.json`: TypeScript 5.9.3 checker probe and output.
- `scip-fixture/`, `scip-fixture-unresolved/`: SCIP inputs.
- `scip-index*.json`, `scip-*.txt`, `scip-*.log`: decoded indexes and checks.
- `bygone-run.json`: one pinned-source smoke run; its confidence histogram is
  stage instrumentation, not a calibrated accuracy/coverage metric.

With pinned cgg 0.11.2 on PATH, from this directory:

```sh
cgg fixtures/ts -t json --no-entry-nodes
cgg fixtures/ts -t json --no-entry-nodes --reference-edges
cgg minimal/py -t json --no-entry-nodes
cgg minimal/ts -t json --no-entry-nodes
```

Substitute `fixtures/py` or `fixtures/go` for the other languages. Tool output
includes nonsemantic timing/path differences.

To reproduce the native TS probe, point `TYPESCRIPT_MODULE` at an installed
TypeScript 5.9.3 package (Bygone's `node_modules/dependency-typescript` works):

```sh
TYPESCRIPT_MODULE=/absolute/path/to/typescript node ts-native.cjs
```

For SCIP, install `@sourcegraph/scip-typescript@0.4.0` in an isolated tool
directory with npm scripts disabled; use SCIP CLI 0.10.0 to decode:

```sh
scip-typescript index --cwd "$PWD/scip-fixture" --output /tmp/probe.scip --no-progress-bar
scip print --json /tmp/probe.scip
scip lint /tmp/probe.scip
```

The original run used Node 26.10.0, outside the indexer's documented supported
Node versions. Missing external symbol definitions caused lint findings; see the
evaluation for their interpretation. The UTF-16 check file retains its original
temporary path; its source text is preserved in `scip-fixture/consumer.ts`.
