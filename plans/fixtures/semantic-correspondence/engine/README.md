# RefactoringMiner interface smoke

Observed 2026-10-22 at revision
`e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`. These newly authored synthetic
inputs test execution and output shape. They are development probes, not
held-out matching or behavior-equivalence evidence.

The [research adapter is now implemented](../../../semantic-correspondence-experiment.md#mapping-adapter-implemented-2026-10-22)
as of the 2026-10-23 planning update. The adapter requirements below describe
what this earlier MCP-only probe established; they do not imply that the Java
exporter is still unimplemented. Its results remain separate from these probes.

## Retained evidence

`multifile.request.jsonl` contains initialization, a three-file rename/body-edit
request, and a two-file module-relocation request. `anonymous.request.jsonl`
contains initialization and a two-file anonymous-export/body-edit request.
The corresponding `.output.log` files preserve raw JSON responses and engine
log messages. [The observation](observation-2026-10-22.json) extracts the three
structured results and records request/output hashes, supplied file counts,
engine pin, platform, and local image ID. The raw multi-file session also
contains an unsupported `shutdown` request and its administrative error;
both analysis requests returned `status: ok`.

| Probe | Supplied files per side | Reported files per side | Refactorings / AST diffs / moved AST diffs |
| --- | ---: | ---: | --- |
| Exported arrow rename plus body, import/call, and inline-arrow edits | 3 | 3 | 1 / 3 / 0 |
| Identical module relocated; consumer import changed | 2 | 1 | 0 / 1 / 0 |
| Anonymous default arrow edit plus named-arrow rename/edit | 2 | 1 | 0 / 1 / 0 |

The first result identifies `add` → `sum` as a Rename Method, with a body edit
also present. Both locations report line 1, start column 8, end column 0.
No exact range claim follows until coordinate conventions are verified against
the full source text. Anonymous-arrow/export syntax is accepted, but successful
anonymous-symbol correspondence was not demonstrated.

The zero move count is not evidence that the engine cannot match moved code.
The pinned [file-content implementation](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/src/main/java/org/refactoringminer/rm1/GitHistoryRefactoringMinerImpl.java#L2665)
calls `processIdenticalFiles` before building models. That method removes
same-path and renamed identical files from the supplied maps; it can choose
among multiple equal-content destinations using path distance. The result's
file counts describe remaining maps, not the full supplied input. In these
probes the relocated file and unchanged consumer respectively disappear from
those counts. An adapter must retain original snapshots, independently record
all inventory/competitors, and pass map copies. Its output must distinguish
preprocessing exclusions from analyzed paths and true unmatched declarations.

The [MCP result record](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/src/main/java/org/refactoringminer/mcp/McpAnalysisResult.java)
contains counts, bounded refactoring records, and warnings. The
[location record](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/src/main/java/org/refactoringminer/mcp/McpRefactoringResult.java)
does not expose byte/UTF-16 offsets or the complete mapping/edit graph. A Java
exporter over `ProjectASTDiff`/`ASTDiff` remains the next experiment. Confidence
is **high** in this interface limitation from source and observed output; an
export of the full graph with slice-verified ranges would change the adapter
assessment. General JS/TS accuracy remains unknown.

## Reproduce the pinned build and protocol

With Docker installed, from a temporary directory:

```sh
git clone https://github.com/tsantalis/RefactoringMiner.git rm-source
git -C rm-source checkout --detach e7b8db328e7d678bc474ebf4b61739b6d6c85b7f
docker build --platform=linux/amd64 --file rm-source/docker/Dockerfile --tag bygone-semantic-rm:e7b8db328e7d678bc474ebf4b61739b6d6c85b7f-amd64 rm-source
docker run --rm -i --platform=linux/amd64 bygone-semantic-rm:e7b8db328e7d678bc474ebf4b61739b6d6c85b7f-amd64 mcp
```

Into the running terminal, paste the initialization line, initialized
notification, and analysis lines from one retained request file. Keep stdin
open until responses for request IDs 2 and 3 (multi-file), or 2 (anonymous),
arrive, then close stdin. Response order is asynchronous; compare by request
ID. Omit the archived multi-file `shutdown`/`exit` lines. Closing stdin
immediately after piping a file can stop the server before analysis completes.
This is a manual smoke replay, not an automated accuracy checker.

The observed host was macOS arm64 with Docker 29.8.1. The pinned upstream
Dockerfile uses Java 17 and builds with `-x test`; its base image tags and
transitive dependencies are not locked by this source pin. The archived image
ID records the actual local build, not a promise of byte-identical rebuilds.
The Linux-arm64 image built and passed `mcp --smoke`, but actual parsing failed:
`Lib /libswc4j-linux-arm64.v.2.2.0.so is not found`. The pinned
[dependencies](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/build.gradle)
include macOS-arm64 and Linux-x86_64 SWC4J binaries, not Linux-arm64.
The successful analysis used Linux/amd64 emulation. This does not establish a
native macOS-arm64 failure; that runtime was not tested. No host Java was
installed. RefactoringMiner is [MIT licensed](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/LICENSE);
retain its notices if distributing copied code or substantial portions.

Not checked: full upstream tests, broad matching precision/recall, project
aliases or module binding resolution, complete AST export, Unicode/byte range
fidelity, latency/memory, renderer behavior, or reviewer benefit. The engine
results do not establish unchanged program behavior. Product tests were skipped
because these changes only preserve planning experiments.
