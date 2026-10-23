# RefModel-style hypotheses on Bygone changes

## Decision

Use a model to propose and explain relationships on top of independent source
evidence. Keep the inventory, correspondence endpoints, local edits, parse
status, and uncertainty as the authoritative representation. Do not adopt
RefModel's catalog as Bygone's data model, or let a model label hide edits.

Confidence is **medium** that this is a useful research direction and **low**
that the model adds reviewer value over the implemented mapping adapter. The
test establishes concrete strengths and failures, not broad accuracy or user
benefit. A larger independently adjudicated corpus and a reviewer task comparing
the adapter alone with model annotations would change that assessment.

## Experiment

Thirty fixed comparisons plus two separate diagnostics, two prompt arms per
model. One arm uses RefModel's pinned original prompt builder and 19 definitions.
The other receives the same code scope plus independent inventory/correspondence
hints and requests structured hypotheses, exact source quotations, additional
edits, uncertainty, and an unassessed behavior status. Both evidence and prompt
design change, so differences cannot be attributed to evidence alone.

The preliminary GPT-OSS 120B pass used configured Ollama cloud inference.
Following the user's GPT/Codex preference, the primary follow-up uses existing
ChatGPT authentication through Codex CLI 0.163.0, `gpt-6.1-sol`, medium reasoning,
fresh ephemeral sessions, and no task tool use. Requested aliases are not
immutable checkpoints. Codex system context and provider sampling differ from
Ollama; these are diagnostic runs, not a controlled model leaderboard.

The original protocol was frozen before inference and retained unchanged.
The Codex protocol was frozen before its calls, after the earlier outputs had
been inspected. No task-case retries or post-output prompt tuning were used.
Raw final answers and mechanical source checks are retained; internal reasoning
is not. [Reproduction and limitations](refmodel/README.md) describe the exact
inputs, upstream revision, hashes, runner, and scope.

All **64/64 Codex calls completed**, with zero completed tool items. All 64
task-prompt hashes match the preliminary run (the common harness wrapper is
recorded separately). Grounded outputs passed the whole-response validator on
**30/32 cases**, including **5/6** responses containing operation labels.
These are source/shape acceptance counts, not operation accuracy. The plain
arm does not request structured citations, so it has no comparable acceptance
metric.

| Codex timing, including CLI overhead | Plain | Grounded |
| --- | ---: | ---: |
| Median per call | 8.82 s | 18.00 s |
| p95 per call | 19.78 s | 59.23 s |

These are one run with four concurrent inference processes, mixed prompt
sizes, and harness context/caching. They do not establish product latency or a
causal overhead from evidence alone. Raw and mechanical reports:
[Codex](results/refmodel-codex-2026-10-22.json),
[Codex source checks](results/refmodel-codex-2026-10-22.scored.json),
[preliminary GPT-OSS](results/refmodel-2026-10-22.json),
[preliminary source checks](results/refmodel-2026-10-22.scored.json).

## Observations from the Codex answers

The plain prompt is already useful at describing mixed edits: it explicitly
notices accumulator changes, the changed Unicode literal, changed rate binding,
and the changed import provider. A model is not inherently blind to nested
edits. The grounded variant makes those edits separately citeable and keeps
behavior unassessed.

| Case | Plain prompt | Evidence-constrained prompt |
| --- | --- | --- |
| Two identical old origins become one destination (`control-05`) | Calls this Move Method from both files into one shared implementation. | Preserves both potential origins and declines to establish lineage. |
| Same signature, calculation replaced with `fetch` (`control-07`) | Calls it Move Method, but explicitly flags the changed body and behavior. | Describes the replacement and leaves movement uncertain. Either history is plausible; shared names alone cannot decide. |
| Malformed destination (`control-10`) | Calls it Move Method but qualifies it as an attempted, incomplete move. | Reports parse diagnostics and declines a completed analysis; does not infer removal from a missing inventory entry. |
| Unchanged body, changed rate binding (`mixed-05`) | Calls module declarations Move Method/Move Field and notices `1` to `2`. | Cites both declarations and initializer change; abstains from class-member labels. |
| Unicode move/rename/edit (`mixed-06`) | Identifies move/rename and the changed literal. | Cites all three changes, but declines the rename label because behavior changed; this is overly restrictive when operations can coexist with edits. |
| Imported extraction diagnostic | Correctly describes extraction and observes the catalog cannot express it. | Cites loop-to-call replacement, new helper, and added import; passes source checks without inventing a catalog label. |
| Real seven-file tour-details rewrite | Lists all six moved functions and two parameter removals, but omits the removed assessment validation. | Explicitly quotes the deleted validateAssessment call and changed allowed-key list, alongside the relocation. Whole response fails source checks on other citations. |

The grounded answers are conservative about unknown origins, but catalog use
is inconsistent: identical standalone function relocations sometimes receive
Move Method and sometimes get only prose because the definition says between
classes. In `control-02` it accepts a standalone-function Rename Method while
declining Move Method; in `mixed-06` it declines Rename Method because a literal
also changes. That is a limitation of this prompt/schema, not evidence that
those source correspondences are absent.

The two rejected Codex grounded responses show locator limitations. The arrow
function case quotes an enclosing variable declaration while claiming the
narrower function-expression symbol span. The real rewrite uses some repeated
quotations, with the validator's first occurrence outside a claimed symbol.
It also quotes `} from './tourAssessment';` without a unique occurrence.
The useful assessment-removal observation does not make the entire report
acceptable. Future work needs precise range/occurrence locators or smaller
symbol-local inputs; this experiment does not weaken its frozen checks or
repair model outputs after the fact.

## Preliminary GPT-OSS pass

All 64 calls returned final answers. Only **21/32** grounded reports passed the
whole-response source/shape validator; **4/12** grounded reports containing
operations passed. Rejections include reindented or fabricated quotations,
citations outside their claimed symbol, and missing inventory endpoints.
This checks evidence integrity, not correctness of accepted labels. Invalid
reports are rejected as a whole, without silently salvaging valid portions.

The real seven-file rewrite produced a particularly revealing failure: the
grounded response invented ellipsis declarations and comments such as
`// import removed – hash no longer used` as if they appeared in source. It
also mislabeled a module split as Extract Class. The validator rejects it.
The plain response identified movement and parameter removal, but omitted the
specific removed assessment validation call.

On scope-only added-file history snapshots, the plain GPT-OSS answers invented
prior helper implementations or signatures (`history-02`, `history-06`,
`history-09`, `history-10`). The grounded answers explicitly state the missing
before scope. The Codex answers inspected for these same snapshots also abstain
with the plain prompt, so this failure is not universal across models.

## Why there is no headline precision/recall

The retained score contract includes Move Class, absent from the upstream
catalog. Extract Method is also absent, while most fixture moves concern
module-level functions rather than class members. Whole-file relocation has no
dedicated category. These are coverage/definition mismatches, not ordinary
classifier misses. The overload addition in `history-01` also supports a
reasonable descriptive parameter-addition interpretation despite an empty
frozen expected-label list.

The two-origin and wholesale-rewrite controls expose uncertain history;
predicting a qualified operation there is different from claiming one unique
proven origin. Single-label scoring erases that distinction. Labels and raw
answers remain available for inspection, but the experiment does not publish a
misleading aggregate precision number. This is agent adjudication, without an
independent or blinded human pass.

## Architectural consequence

Represent language-neutral symbol correspondence and source edits first.
Attach proposed operation labels, rationale, supporting source IDs, and
uncertainty to that evidence. A model may propose a relationship absent from
the engine hints, but it remains an unsupported hypothesis until checked.
Do not equate a valid quotation, an engine hint, or an `unassessed` field with
a correct explanation or preserved behavior.

The next useful test is whether these annotations improve a real review task
over the adapter's complete local diffs. More label prompting on this already
inspected corpus would not establish that. No product code, UI, dependency,
semantic hiding policy, Python integration, or reviewer study was implemented
as part of this test. Product build and full product tests were skipped.

Verification: six validator/scorer tests passed; targeted JS lint and Python
syntax checks passed; all 30 original fixture inventories/range digests still
reconcile using the main checkout's installed TypeScript dependency via
`NODE_PATH`. The first fixture-check invocation lacked that environment setting
and failed to resolve TypeScript; the corrected invocation passed. No new
dependency was installed. No independent or blinded adjudication, repeated
model runs, or product performance check was performed.
