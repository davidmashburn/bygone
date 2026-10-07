# Text-block move tracking: research

Research date: 2026-10-07. Companion to the
[scope and implementation proposal](text-block-move-tracking.md).

This is a targeted literature and source review, not a systematic survey or a
reproduced benchmark. Primary project documentation, selected source code, and
papers support the observations below. Recommendations for Bygone are our
inferences. Tools were not installed or run for this research; mutable upstream
branches and reported benchmark results must be pinned/reproduced for a spike.

## Open-source approaches

| Project | Verified behavior / technique | What Bygone can borrow | Boundary |
| --- | --- | --- | --- |
| Git | `--color-moved` relates added and removed text; block mode greedily finds runs with at least 20 alphanumeric characters; zebra modes separate adjacent runs; whitespace modes are independent | An inexpensive exact-move baseline and a distinct information-size gate | Coloring is not a durable provenance ledger; `-M/-C` identify file renames/copies, not arbitrary block lineage. [Manual](https://git-scm.com/docs/git-diff) |
| VS Code / Monaco's editor sources | Same-file moved-code display with arrows and a block Compare action; slightly edited moves supported | Closest reference for interactive presentation and a bounded line-based pass | Does not establish repository-wide lineage. [Release behavior](https://code.visualstudio.com/updates/v1_82#_moved-code-detection), [matcher source](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/diff/defaultLinesDiffComputer/computeMovedLines.ts) |
| WinMerge | Optional moved-block detection, separate moved/selected colors, and lines linking locations in the overview bar | Endpoint emphasis and an overview without filling the editor with ribbons | Documentation demonstrates presentation, not a measured provenance accuracy guarantee. [Manual](https://manual.winmerge.org/en/Configuration.html), [comparison guide](https://manual.winmerge.org/en/Compare_files.html) |
| wikEdDiff | Inline visual diff with move markers, moved-block highlighting, and refinement through paragraphs, lines, sentences, words, and characters | Language-independent prose handling and navigation from a missing source to its destination | Different inline presentation and matching model; no assumption it provides copy lineage. [Project documentation](https://www.mediawiki.org/wiki/Extension:WikEdDiff) |
| Difftastic | Parses supported input and compares syntax trees; uses a line-oriented fallback for unsupported or very large input | A syntax-aware comparison baseline for code reformatted while moving | Structural diff is not automatically a solution for cross-file copies or persistent origin tracking; the inspected introduction does not establish those capabilities. [Official manual](https://difftastic.wilfred.me.uk/introduction.html) |
| GumTree | AST differencing with movement actions and an extensible implementation | Distinguish node mapping from edit-script generation; useful later for syntax-aware evidence | Parser/AST integration and source-coordinate mapping increase scope; not a generic prose solution. [Repository](https://github.com/GumTreeDiff/gumtree), [2014 paper](https://notes.billmill.org/images/gumtree.pdf) |
| RefactoringMiner | AST diff and refactoring detection; web views include code moved between files and overlapping refactorings | Reference for cross-file block comparison and explicit refactoring evidence | Language/runtime support must be checked per fixture; refactoring labels require stronger evidence than lexical resemblance. [Repository and feature documentation](https://github.com/tsantalis/RefactoringMiner#ast-diff-features) |
| Open-NiCad | Clone comparison after configurable normalization; its 0.30 difference threshold concerns pretty-printed lines | Explicit normalization policy and separate exact/near-miss clone evaluation | A clone match establishes similarity, not which occurrence was copied or moved. [Repository](https://github.com/CordyJ/Open-NiCad) |
| SourcererCC | Token-based clone detection with an optimized inverted index and filtering | Retrieve likely origins without all-pairs comparison | Retrieval based on token overlap needs ordered verification and snapshot bookkeeping for a diff product. [Authors' paper](https://arxiv.org/abs/1512.06448) |

Delta also supports Git's color-moved output; treat it as a presentation
reference rather than an independent source of move ground truth.
[Project README](https://github.com/dandavison/delta/blob/main/README.md).

### A concrete source inspection: VS Code

The inspected `computeMovedLines.ts` first looks for simple deletion/insertion
pairs of at least three lines with fragment similarity above 0.90. A second
path matches three-line hash windows inside remaining changes, extends runs,
and resolves overlap. It joins nearby moves, filters small results, and removes
moves within the same diff region. A final size gate requires at least 15
trimmed characters and at least two lines of length two or more. These are
several gates serving different purposes, not one universal similarity setting.
[Source inspected](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/diff/defaultLinesDiffComputer/computeMovedLines.ts).

For Bygone, inspect moves inside replacement hunks explicitly: adopting that
same-region exclusion unchanged would leave a requested case uncovered. Also
separate copy detection from this deletion/insertion path, because a retained
source never becomes a deletion. These are design deductions, not reported
defects in VS Code. Pin the source commit before implementing a comparison.

### Adoption decision

Build a small shared text matcher around Bygone's current engine first. Use
Git and VS Code as baselines, not runtime dependencies. Benchmark AST and clone
tools only where their models fit the input. Existing tools provide useful
algorithms and presentation examples, but the inspected evidence does not
establish a drop-in component covering arbitrary text, copies, uncertainty,
incremental browser workers, and Bygone's accounting requirements together.

No upstream source has been copied. Before any code reuse, inspect the exact
revision's license and integration costs; a paper describing an algorithm is
not evidence that every implementation can be embedded under the same terms.

## Academic foundations and relevance

### Structured change detection

**Chawathe, Rajaraman, Garcia-Molina, and Widom (SIGMOD 1996), “Change Detection
in Hierarchically Structured Information.”** Formulates change detection as
finding an edit script between structured versions and exploits domain
characteristics for tractability. The publisher abstract was inspected; the
full paper's algorithms were not independently reproduced. Relevant lesson:
choose explicit operations and costs instead of treating a visual diff as
the operation model. Our line/copy design is not an implementation of this
tree algorithm. [Publisher](https://doi.org/10.1145/233269.233366).

**Falleri, Morandat, Blanc, Martinez, and Monperrus (ASE 2014), “Fine-grained
and Accurate Source Code Differencing.”** GumTree separates AST mapping from
edit-script production. Its mapping uses top-down identical-subtree anchors
and bottom-up recovery, including movement in the resulting script. It seeks
useful explanations of changes through heuristics rather than promising a
unique reconstruction of developer intent. For Bygone, this supports an
exact-first candidate strategy followed by cautious edited matching; the
AST-specific metrics should not be transplanted as text thresholds.
[Paper, mirrored author manuscript](https://notes.billmill.org/images/gumtree.pdf),
[canonical DOI](https://doi.org/10.1145/2642937.2642982).

### Fingerprints and clone detection

**Schleimer, Wilkerson, and Aiken (SIGMOD 2003), “Winnowing: Local Algorithms
for Document Fingerprinting.”** Selects local fingerprints of overlapping
k-grams; a shared substring of length at least `w + k − 1` contains a selected
matching fingerprint under its model. This is a candidate-retrieval guarantee
for sufficiently long exact substrings, not proof that a whole edited block
is a move. The treatment of noise and repeated low-information text is directly
relevant. Bygone would still verify content, boundaries, survival, and competing
origins; budget-based pruning weakens any retrieval completeness guarantee.
[Author-hosted paper](https://sschleimer.warwick.ac.uk/Maths/winnowing.pdf).

**Roy and Cordy (ICPC 2008), “NICAD: Accurate Detection of Near-Miss Intentional
Clones.”** Combines extraction/normalization with comparison to detect near-miss
clones. It explores several difference thresholds, illustrating that granularity
and normalization determine what a score means. For Bygone, retain separate
raw and normalized evidence and test exact, renamed, and structurally edited
cases separately. Normalization suitable for clone search can erase precisely
the identifier or literal edit a reviewer needs to see.
[Author-hosted paper](https://research.cs.queensu.ca/home/cordy/Papers/RC_ICPC08_NICAD.pdf).

**Sajnani, Saini, Svajlenko, Roy, and Lopes (ICSE 2016; preprint 2015),
“SourcererCC: Scaling Code Clone Detection to Big Code.”** Uses a token index
and filtering to avoid exhaustive block comparisons, evaluated with real and
injected clone benchmarks. Useful for eventual cross-file candidate retrieval.
Its clone-search objective differs from explaining one revision boundary:
Bygone additionally needs an ordered alignment, distinct occurrences, and
one-destination ownership. Published scale results have not been reproduced
and do not predict browser-worker latency.
[Authors' preprint](https://arxiv.org/abs/1512.06448).

### Block history and evaluation quality

**Hasan, Tsantalis, and Alikhanifard (2024), “Refactoring-aware Block Tracking
in Commit History.”** CodeTracker follows blocks through changes and
refactorings across commits. It is the closest researched precedent for the
eventual history requirement, beyond two-snapshot highlighting. Its reported
precision/recall applies to its evaluated task and corpus, not arbitrary text.
For Bygone, history needs explicit occurrence continuity and change events;
it cannot safely consist of chaining fuzzy scores or content hashes.
[Authors' preprint](https://arxiv.org/abs/2409.16185),
[author-hosted paper](https://users.encs.concordia.ca/~nikolaos/publications/TSE_2024.pdf).

**Islam, Aowal, Uddin, and Chowdhury (2025), “HistoryFinder: Advancing
Method-Level Source Code History Generation with Accurate Oracles and Enhanced
Algorithm.”** The inspected abstract describes correcting history ground-truth
oracles with expert-guided validation. It cautions against accepting another
tool's output as truth. Bygone's corpus should admit ambiguity, preserve manual
adjudication notes, and separate threshold tuning from held-out evaluation.
Method-history findings do not directly establish line-block accuracy.
[Authors' preprint](https://arxiv.org/abs/2507.14716).

### Further reading not used as algorithm evidence

Heckel's 1978 “A technique for isolating differences between files” is a
historical lead for text differencing. Its publisher endpoint returned 403
during this research, so no algorithm details are attributed to an unread
full text. [Publisher DOI](https://doi.org/10.1145/359460.359467).

The 2024 GumTree follow-up, “Fine-grained, accurate and scalable source
differencing,” is a lead for a later AST benchmark. Its full text was not
reviewed here; do not treat the 2014 paper as a description of every current
GumTree matcher. [Publisher DOI](https://doi.org/10.1145/3597503.3639148).

## Visual precedents

- **VS Code:** arrows establish location, and Compare isolates the source and
  destination to expose edits. This supports a separate block-detail action.
  [Documented interaction](https://code.visualstudio.com/updates/v1_82#_moved-code-detection).
- **WinMerge:** overview connectors and selected-move emphasis suggest keeping
  the global map small and highlighting only the active relationship.
  [Documentation](https://manual.winmerge.org/en/Compare_files.html).
- **wikEdDiff:** inline source markers demonstrate a useful alternative when
  both endpoints cannot be displayed side by side. Its paragraph-to-character
  refinement is particularly relevant to prose.
  [Features](https://www.mediawiki.org/wiki/Extension:WikEdDiff).
- **Git zebra/dimmed-zebra:** block boundaries and repeated moved content can
  be visually distinguished. Bygone should test explicit IDs and selective
  emphasis before adding another full-background palette.
  [Options](https://git-scm.com/docs/git-diff).

These are implementation precedents, not controlled evidence that one
visualization improves comprehension. A Bygone prototype must test whether
reviewers find edits inside moved code and distinguish duplication from
relocation. Keep that study separate from detector accuracy benchmarks.

## Synthesis

Use different mechanisms for different questions: ordered diff for changed
bytes, fingerprints/indexes for candidate origins, verified text comparison
for similarity, occurrence constraints for moves versus copies, and explicit
graph edges for future history. A single similarity number or AST edit script
does not answer all five. This is the design inference carried into the
[scoped proposal](text-block-move-tracking.md), with corpus and interaction
gates before any production defaults are selected.
