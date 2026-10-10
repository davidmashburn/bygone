# Tour reasoning and salience

Status: Research-backed proposal; narrative experiment first. Saving this plan
does not establish reader comprehension or authorize implementation.

## Goal

Help a reader explain what a change does, why its implementation produces that
behavior, what the evidence establishes, and what remains uncertain. Keep the
reader oriented as the narrative, file, and revision comparison change.

Optimize for a coherent explanation rather than a target word count. The
reader needs enough causal reasoning to evaluate the change, with emphasis
that makes the important relationships apparent.

## Context and preserved material

Research and source inspection were performed on 2026-10-10 in
[Clarify Tour Scene Framing](t3-thread://v1/4b887c25-e28f-4e36-ab80-97911377e0b6).

- [Full conversation context and research assessment](tour-reasoning-and-salience-context.md)
  preserves the available user and assistant messages through the research
  response, including the original complaints, rejected iterations, and
  previously reported validation. It excludes tool logs and private reasoning.
- [Interactive three-step example](mockups/tour-reasoning-and-salience.html)
  preserves the illustrative rewrite from the research response as a
  self-contained HTML document. It is a design sketch, not the live viewer.
- [Tour orientation, scene framing, and conclusions](tour-orientation-and-narrative-framing.md)
  is the earlier implementation plan. This follow-up qualifies its presentation
  strategy in light of subsequent user feedback; it does not undo its evidence
  identity, explicit overview, navigation, or bookend requirements.
- [Tour presentation review](../ideas/tour-presentation-review.md) records an
  earlier UI investigation.
- [Review comprehension](review-comprehension.md) and its
  [case study](review-comprehension-case-study.md) provide the evaluation
  framework. Reuse them rather than creating another parallel review system.
- [Workspace identity and sidebar context](workspace-identity-and-sidebar-context.md)
  governs where persistent orientation belongs. Do not add another metadata bar
  merely because the standalone illustration uses a compact context line.

### User feedback that must survive implementation

The initial problem was jarring directory-overview landings at scene changes,
uncertainty about whether the comparison changed, unclear scene purposes and
hierarchy, and the absence of a deliberate tour conclusion.

Subsequent iterations exposed competing failures:

1. A comprehensive chapter/scene map with files, ranges, and dotted numbering
   prompted “oh no, major tmi!!”
2. Hiding the same inventories behind “Scope details” did not solve the
   problem: “no, not more scope details. Need LESS info, more salience...”
3. Removing numbering entirely went too far. The user still wanted numbered
   chapter, scene, and step lists for reference, without repeated x.x notation
   throughout prose, headings, and narration.
4. Shortening the tour left a more fundamental omission: “What does this
   change *do*”.
5. Persistent Back and Next controls were explicitly requested because
   scrolling was awkward as the primary navigation mechanism.
6. The research request was to reconsider the strategy: it ranged between
   overly terse and overwhelmed with details, while the desired qualities
   were reasoning and salience.

These are requirements about selection, explanation, and emphasis. Do not
interpret them as a request for universal brevity, extra disclosures, a fixed
slide count, or elimination of hierarchy.

## Diagnosis and confidence

The earlier iterations changed text volume and navigation without adequately
deciding what the reader should understand at each point.

The inspected navigation example mixes explaining the code change with
explaining Bygone's presentation machinery: inventories, synthetic stages,
historical commits, reading levels, and mode switching. Each statement may
be accurate while its relevance changes from one paragraph to the next.
The reader must reconstruct the causal argument while learning the interface.

The marker-fix scene is a stronger starting point: it relates layout events,
synchronization, and lost code focus, then identifies what the guard must
preserve. The improvement opportunity is to make that causal structure the
organizing principle across the tour.

Confidence is high in the diagnosis from the source and repeated user
feedback. Confidence is moderate in the proposed presentation behavior.
Research supports the direction but does not establish one universally
optimal code-tour format.

Evidence that would change the assessment:

- Readers understand existing prose but still fail to identify the active
  comparison: prioritize viewer transitions and evidence identity.
- A narrative rewrite improves recall of claims without understanding their
  mechanism or limitations: revise the explanation and verification tasks.
- Readers need a directory map for a particular cross-file relationship:
  use it deliberately for that question.
- Experienced readers are slowed by setup that unfamiliar readers need:
  preserve direct navigation and optional exploration, then test audience fit.
- A causal sequence biases readers into accepting an unsupported claim:
  strengthen counterevidence, limitations, and access to the complete diff.

## Research basis and limits

### Assertion–evidence presentation structure

[Garner and colleagues, research on slide design](https://www.writing.engr.psu.edu/research.html)
report better understanding and retention when a technical presentation used
sentence headlines stating a main message supported by visual evidence,
compared with topic/subtopic slides while narration was held constant.

Application: use a meaningful claim or consequential question to organize a
scene; select evidence that lets the reader evaluate it. A title naming a file
or activity is rarely enough. This is an adaptation from technical
presentations, not a direct experimental finding about Bygone.

### Coherence, signaling, proximity, and pacing

[Mayer, Using multimedia for e-learning (2017)](https://onlinelibrary.wiley.com/doi/abs/10.1111/jcal.12197)
synthesizes research supporting removal of extraneous material, highlighting
essential information, proximity of words and corresponding visuals, and
self-paced segmentation. Effects have boundary conditions, including prior
knowledge.

Application: remove repeated inventories and framing, keep explanation beside
its evidence, and preserve Back/Next navigation. Do not remove causal links
just to reduce words. Do not mechanically apply narration/text redundancy
findings to remove accessible text or user control.

### Decomposition does not supply rationale by itself

[di Biase and colleagues, The effects of change decomposition on code review—a controlled experiment (2019)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7924728/)
studied 28 developers. Decomposition reduced false positives and changed
review behavior, but did not improve understanding of change rationale or
the number of defects found in that experiment.

Application: more chapters, smaller scenes, and more checkpoints cannot
substitute for explaining why code produces the intended result. This does
not establish that decomposition is useless or that all scene boundaries
should disappear.

### Guided narrative with reader exploration

[Segel and Heer, Narrative Visualization: Telling Stories with Data (2010)](https://homes.cs.washington.edu/~jheer/files/narrative.pdf)
describe interactive slideshows that combine an authored sequence with
exploration within the narrative.

Application: provide an understandable route, let readers inspect surrounding
evidence, and preserve their return position. This is a design-space analysis
and precedent, not controlled proof that a particular Bygone layout is best.

### Supporting code-comprehension research

[Code Review Comprehension: Reviewing Strategies Seen Through Code Comprehension Theories (2025)](https://arxiv.org/html/2503.21455v1)
describes reviewers constructing mental models that connect goals to
implementation, using multiple navigation and comprehension strategies.

[How Do Software Engineers Understand Code Changes? An Exploratory Study in Industry (2012)](https://www.microsoft.com/en-us/research/publication/how-do-software-engineers-understand-code-changes-an-exploratory-study-in-industry/)
identifies information needs such as completeness, consistency, and effects on
other components, alongside the usefulness of issue-aligned decomposition.

These support preserving rationale and investigative access. Neither validates
this proposed presentation, exact copy lengths, or a universal scene count.

## Proposed approach

### 1. Give every scene an explanatory job

A scene should resolve a question that changes the reader's understanding:
why a bug happens, how a design prevents it, what behavior must survive, or
what uncertainty remains. Steps develop that explanation through evidence.

Authoring test: “What can the reader now explain that they could not explain
before this scene?” Merge or remove a scene without a distinct answer.

A single comparison can support several questions. A scene can cross files
when that is necessary to follow the mechanism. File boundaries, commit
boundaries, and fixed step counts do not determine the argument.

### 2. Keep the reasoning in the main reading path

Connect the outcome to the mechanism and the supporting evidence. Explain
the inference between source code and the claimed behavior. Include a material
tradeoff, preserved behavior, or uncertainty when it changes the conclusion.

Words such as “because,” “therefore,” “however,” and “this preserves” can
carry the important relationships. Removing those connections may make prose
shorter while increasing the reader's work.

“Why this works” must not require opening a details disclosure. Metadata can
remain available in existing evidence/navigation surfaces. Do not introduce
a mandatory form with separately repeated claim, cause, proof, and takeaway
fields; these are authoring responsibilities, not prescribed UI labels.

### 3. Let hierarchy organize the explanation without interrupting it

Chapters group related questions; scenes answer them; steps supply evidence.
A stop is a navigation position, not a fifth level containing scenes.

Keep simple numbers in chapter, scene, and step lists, with steps counting
within their scene. Use plain titles in prose and narration, without repeated
dotted references. Preserve explicit Intro and Conclusion outline entries and
visible Back/Next controls.

A separate chapter or scene introduction should earn its screen by adding
useful framing. Test placing redundant introductions beside the first
evidence view rather than forcing another setup stop. This is a hypothesis;
do not remove existing navigation identities before the narrative trial.

### 4. Make comparison continuity stable and accurate

Keep the actual displayed comparison identifiable through existing evidence
headers and workspace context. Scene changes do not inherently mean new
revisions. A file change does not inherently mean a new comparison.

Explain a meaningful pair change briefly, for example, “Now isolate the later
fix.” Distinguish real revisions from synthetic teaching stages where that
affects interpretation. Avoid repeating full ranges and file lists in prose.

A directory overview belongs where relationships among files are evidence
for the question. Otherwise show the relevant destination evidence or a
behavioral diagram. “Retain relevant code” means maintain useful visual
continuity only when the code supports the new claim; never leave stale
previous-scene evidence under unrelated narration. Preserve the earlier
plan's deterministic destination and direct-link semantics.

### 5. Conclude with what the evidence establishes

Reconnect the mechanism to the promised behavior, identify meaningful
limitations, and stop. Reciting chapter titles is not a substantive conclusion.

Place tests near the behavior they support. Give verification its own scene
only when it resolves a distinct question. Do not imply that callback checks
establish full-interface behavior or reader comprehension.

## First narrative experiment

Start with the existing navigation lab, organized around two reader outcomes:

1. Preserve your place while moving between overview and code.
2. Preserve code focus when the panel layout changes.

Introduce tour modes only where they alter evidence interpretation. Do not
make learning Bygone's internal presentation taxonomy a prerequisite for
understanding the change.

For the marker fix, the preserved illustration develops one scene in three
steps:

1. Panel resizing can emit a scroll event without changing position;
   synchronization can then move highlighted code out of view.
2. The new guard redraws connectors and returns when neither axis moved,
   allowing actual movement to retain the existing synchronization path.
3. The assertions distinguish width-only changes from vertical/horizontal
   movement. They support event routing; full-interface marker visibility
   remains a separate browser check.

The illustration includes a stable comparison label and Back/Next. It is a
concrete example of causal prose, not a mandate for three steps, a new component,
or another scope strip.

Then apply the same authoring approach to a separate multi-commit feature.
Use the feature to exercise multiple scenes sharing a comparison, deliberate
comparison changes, and a real reason to inspect cross-file relationships.

## Implementation sequence and decision gates

1. Recheck the current implementation base and existing authoring skill.
   The inspected feature branch is not necessarily the integration base.
2. Rewrite the two representative narratives using existing source fields.
   Keep exact evidence anchors and supported claims. Do not expand the schema
   or redesign the viewer merely to conduct this trial.
3. Review prose against the underlying change. Identify causal claims,
   preserved behavior, proof boundaries, and any unsupported author intent.
4. Validate/compile the tour artifacts and walk the proposed reading route.
   Confirm source validity separately from explanatory quality.
5. Run the reader pilot below and record concrete confusion and answers.
6. If content is understandable but transitions still cause disorientation,
   implement the smallest viewer change supported by those observations.
   Candidate: combine redundant setup with first evidence while preserving
   reading identities and accurate comparison labels.
7. Update authoring guidance and examples from observed findings. Consider
   schema or automated checks only for mechanical properties that can actually
   be validated; do not label structural validity as comprehension.

## Evaluation and acceptance criteria

Use a small bug fix and a multi-commit feature, with a knowledgeable maintainer
checking expected answers. Compare existing and rewritten explanations using
matched unfamiliar changes or counterbalanced order. Rereading the same change
must not be mistaken for an unbiased second first impression.

Ask readers to explain, without coaching:

- What behavior changed, and why does it matter?
- What mechanism produces that behavior?
- Which code or test supports the conclusion?
- What does that evidence leave unresolved?
- At a selected transition, did the comparison change, only the file change,
  or only the explanatory question change?
- Can they return to the relevant step after inspecting other evidence?

Record correct explanations, omitted causal links, unsupported conclusions,
clarification requests, comparison confusion, and navigation effort separately.
Time and preference can be supporting observations; fewer clicks, fewer words,
or preference alone do not prove understanding. A small pilot provides
qualitative evidence, not a statistically validated productivity claim.

Acceptance for the narrative trial:

- The opening states the concrete behavior and a short meaningful route.
- Each scene has a distinct explanatory job and sufficient causal reasoning.
- The main path supplies rationale without scope disclosures.
- Titles and emphasis identify what matters in the adjacent evidence.
- The conclusion reflects supported findings and meaningful limits.
- Simple reference numbering and explicit navigation remain available.
- Full diff access remains possible; the authored selection is not presented
  as exhaustive review.

If runtime changes follow, verify ordinary, historical, deconstructed, and
image-guide tours as relevant; forward/back navigation; direct links and
refresh; file exploration and return; narration; narrow layouts; and exports.
Run the repository's checks appropriate to the actual change. Reuse the earlier
orientation plan's compatibility and evidence-identity cases.

## Scope and non-goals

This plan covers explanatory strategy, example authoring, comprehension
evaluation, and evidence-driven follow-up to the viewer.

It does not authorize immediate production implementation, a new document
hierarchy, a universal word limit, extra scope disclosures, wholesale
navigation replacement, an automatic comprehension score, or removal of full
code access. Existing feature work should be reused where it meets the revised
contract.

## Evidence snapshot and verification limits

Inspected development worktree:
 /Users/davmash/code/worktrees/bygone-tour-orientation

Branch: feat/tour-orientation-and-framing.
Commit: 52b2a31522389bbab9c9d0a9c34a14e215b1aa86.

Relevant development paths, which do not live on this orphan branch:

- examples/navigation-lab.bygone.yaml: reading-path scene near line 78;
  marker-focus and scroll-proof scenes near lines 201 and 219.
- src/tourReading.ts: buildTourReadingItems near line 30 inserts chapter,
  scene, and step reading positions.
- web/host.js: showTourScene, showTourDirectoryOverview, and reading-document
  rendering determine evidence landings and framing.
- docs/generating-change-tours.md: existing questions/evidence guidance and
  “Frame the reading path” section already state several desired principles.
  The gap is their execution and evaluation, not total absence of guidance.

The example's pinned range is
1f8fdc07d56fc7a0e50dcab0383a63159c77178c →
901a193203e4840dbf6e06c6a273fac7f2d713bd.
The hierarchy revision is a50c2a6f58a2dfd7f85039105a27e4b92b98a3f7.
The marker-fix commit is
901a193203e4840dbf6e06c6a273fac7f2d713bd
(fix(presenter): retain tour marker focus after panel changes).
Its media/script.js comment explicitly describes layout-only events and lost
anchor focus; its test/runTests.js additions cover event routing.

The research pass inspected sources and this commit. It changed no product
files. The illustration was rendered at desktop and mobile widths; its
Back/Next behavior received a smoke check. The live viewer, actual audio,
repository tests, and human comprehension were not tested in that pass.
Historical test reports in the context appendix remain historical claims;
they were not rerun or independently re-established by this research.
