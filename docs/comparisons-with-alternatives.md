# Bygone compared with existing tools

**Existing tools can achieve every desired outcome in Bygone's persona/JTBD
map. Bygone's opportunity is to reduce the work and mistakes involved in
achieving those outcomes.** The case for adopting it rests on integrated
comparison, navigation, evidence handling, and context retention. The advantage
must be measured against a well-prepared existing workflow.

This assessment uses **Bygone: inspect and explain changes within an existing
engineering workflow**, at `ideas/bygone-product-map.md` on `project-planning`,
updated October 12, 2026 in commit `3ae6ec0`. That map distinguishes established
capabilities, additions on its inspected branch, and an external workflow
prototype; it is not a current-release inventory. It can be read without
switching branches:

```bash
git show project-planning:ideas/bygone-product-map.md
```

## Comparison by tool and workflow

The comparison is about achievable jobs. Native features, composed workflows,
and custom scripts have different preparation and maintenance costs. A proposed
script is additional engineering work; it is not an existing product feature.

| Alternative | Jobs it can cover without Bygone | Practical workflow | Additional effort compared with an integrated Bygone workflow |
| --- | --- | --- | --- |
| [gitg](https://wiki.gnome.org/Apps/Gitg/) + Git | Discover relevant commits; inspect history; compare versions; establish a historical sequence. | Browse history, narrow the relevant changes with Git searches, extract selected revisions, and compare them. Record a finding or revision sequence in Markdown if someone else needs it. | Multi-revision comparison and explanation require additional tools or manual arrangement. Whether Bygone materially reduces this effort is unmeasured. |
| [VS Code](https://code.visualstudio.com/docs/sourcecontrol/overview) + Git | Inspect diffs and file history; search implementation; compare snapshots; investigate independently; repair code and run checks. | Use source control and Timeline, open comparisons and related code in editor groups, and keep a Markdown reading guide beside them. Add CodeTour when guided steps help. | Managing several revisions and preserving the connection between a passage and its evidence require tabs, links, and deliberate navigation. Existing familiarity may outweigh switching benefits. |
| [GitHub web review](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request) / [GitLab review](https://docs.gitlab.com/user/project/merge_requests/reviews/) | Explain a proposal; inspect the complete change; guide reviewers to decisive evidence; discuss objections; record approvals and decisions. | Put a short reading order and commit-pinned code links in a good PR/MR description. Inspect the full diff and use a checkout/editor for deeper investigation. GitLab can be self-managed. | Following cross-file or cross-revision reasoning can involve more page/editor switching. These platforms already own collaboration and decisions; Bygone should complement that workflow. |
| [Meld](https://meldmerge.org/) / [Beyond Compare](https://www.scootersoftware.com/) + Git | Compare files, directories, and selected revisions; edit changes; inspect images or binary/data differences using an appropriate viewer. | Use Meld's two-/three-way comparisons or Beyond Compare's comparison viewers; extract Git snapshots when necessary. Pair comparisons with a concise reading guide. | Arbitrary revision sequences require multiple comparisons or arranged snapshots. Narrative, provenance, and return-to-guide behavior require separate artifacts or bookkeeping. |
| [CodeTour](https://github.com/microsoft/codetour) + VS Code | Provide guided code navigation; orient an unfamiliar reader; sequence locations and explanations; associate a guide with a Git ref. | Record a tour of consequential locations, reference maintained docs, and inspect relevant diffs or snapshots alongside it. | A guided codebase tour does not by itself reproduce a change-focused, synchronized revision comparison or Bygone's anchor/hunk contracts. Those require composition or custom integration. |
| Git + Markdown/HTML + scripts + existing agent tooling | Extract evidence; prepare structured handoffs; validate references; explain historical or conceptual stages; share fixed snapshots. | Generate a range inventory and patch, write claims with exact evidence locators, validate them under explicit rules, and render the guide. Give review agents repository access beyond the selected evidence. | The builder owns extraction, validation rules, stage provenance, coverage accounting, and integration upkeep. This can achieve the jobs while imposing substantial engineering cost. |

Local operation is a supporting benefit: gitg, Git, editors, and comparison tools
already operate locally. [GitLab can run on infrastructure the user
controls](https://docs.gitlab.com/install/). Opening an existing checkout without
establishing a hosting/review service is a setup distinction, not an exclusive
local capability.

AI explanations are also available elsewhere. [GitHub documents Copilot
assistance for understanding
PRs](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request),
and agents can author ordinary guides and handoffs. The relevant hypothesis is
that Bygone makes explanation and evidence easier to inspect together.

## All five persona situations

A person can occupy several situations. Codebase, language, and domain
familiarity are separate dimensions; agent authorship does not require a tour.

| Persona and desired outcome | Workflow without Bygone | What still requires judgment or effort |
| --- | --- | --- |
| Human reviewer: inspect the relationships that determine whether the proposal works. | Read the requirement and rationale. Follow pinned links from entry point to state transition, consumer, and test. Inspect the full diff, explore outside the path, run checks, and record a supported finding in the existing review venue. | The reviewer evaluates causality and counterexamples. A valid outcome is identifying missing evidence. |
| Human author: direct attention to consequential parts without duplicating the PR description. | Add a short reading order: file, symbol, pinned link, and its role. Reuse the primary rationale, identify mechanical edits, and retain the full inventory. Optionally record a CodeTour. | Prepare and maintain the links and claims. Agent assistance must not fabricate intent. |
| Human investigator: find relevant versions and compare them. | Use history, `git log -S`/`-G`, and extracted snapshots; compare selected versions in an editor or comparison tool. Save a finding only when another reader needs it. | Several comparisons can require manual arrangement. Direct inspection can complete the job without a guide. |
| Reader unfamiliar with the area: connect a documented concept to this implementation change. | Link maintained prerequisites, then trace a concrete input through changed symbols and a behavioral test using Markdown or CodeTour. Ask questions in the existing discussion venue. | Tailor the path to actual familiarity. General learning or missing documentation belongs in maintained docs. |
| Review agent: efficiently locate reasoning and evidence while investigating beyond it. | Supply requirement sources, base/head IDs, inventory, patch, ordered claims and locators, actual check results, and open questions in Markdown/JSON. Provide repository access; return findings separately. | Independently inspect omitted areas and challenge claims. Specialized viewer or tour formats are optional; automated extraction/validation may need scripts. |

The primitives are documented in [Git log](https://git-scm.com/docs/git-log),
[Git show](https://git-scm.com/docs/git-show),
[permanent source links](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files),
and the editor/review tools above. The composed workflows are inferences from
those capabilities, not observed task results.

## All five difficult cases from the map

| Case | Existing-tool route to the same outcome | Tradeoff |
| --- | --- | --- |
| Behavior crosses components. | Number the causal path in the PR: handler → state owner → consumer → behavioral test. Pin each location, explain its relationship to the next, and independently inspect a boundary case. | The author sequences evidence; the reader manages tabs and reconstructs the relationship. |
| Intermediate states matter. | Make a table of real revisions, behavior, and comparisons. Inspect compatibility changes before later switches, using snapshots and pairwise diffs as needed. | Endpoints may conceal the transition; several comparisons require navigation and provenance discipline. |
| Several mechanisms support a guarantee. | Build a claim–evidence table linking validation, persistence, later use, tests, attempted counterexamples, and actual check results. Record gaps. | Reasoning and verification remain necessary. A viewer cannot supply missing evidence. |
| Mechanical edits obscure semantic changes. | Retain the full inventory; use whitespace/moved-line filters, explicit semantic pointers, and an unfiltered final inspection. Separate mechanical commits when safe. | Filters do not establish that an edit is mechanical. A good explanation and ordinary diff filtering may suffice. |
| A reader needs a concept located in unfamiliar code. | Link the maintained concept explanation and select changed symbols/tests implementing it. Add a short reader-specific guide or CodeTour. | Preparation and upkeep remain; primary documentation retains its role. |

These routes use ordinary [diff options](https://git-scm.com/docs/git-diff),
revision inspection, source links, and review artifacts. A small change can have
a difficult relationship; a large mechanical change may need no guide.

## All twelve capability rows

This maps the planning inventory, including explicitly labeled branch additions.
Equivalent goals do not imply the same interaction or automatic guarantees.

| Capability | Substitute | Extent of equivalence |
| --- | --- | --- |
| Desktop, editor, CLI entry | Open files/checkouts in an editor or gitg; use `code --diff` or `git difftool`. | Native entry points. No hosting service is needed for local inspection. |
| Two-way/multi-panel diffs, directories, binary/images | Editor text diffs; Meld two-/three-way files/directories; Beyond Compare viewers; extracted revisions arranged in groups or separate comparisons. | Common cases are native. Arbitrary revision counts require composition and do not reproduce Bygone's synchronized N-panel geometry. |
| History and scoped search | History/Timeline, Git searches, editor search, and searches of historical trees or snapshots. | Native primitives. Distinguish matching content from its introduction/removal. |
| Overview, generated presentation, full inventory | Generate the merge-base-to-head list, summary, and patch; author entry points or script a deterministic ranking. | Native inventory; manual/scripted ordering. Ranking remains a hint, with the full change available. |
| Skill, extraction, source, validation, compilation | Git output plus Markdown/CodeTour and pinned evidence; scripts check objects, paths, line bounds, and expected snippets before rendering. | Custom integration for automatic anchor resolution, exact hunk accounting, and compilation. Links alone do not duplicate those contracts. |
| Opening, chapters/scenes/steps, conclusion | Markdown headings, numbered evidence steps, consequence, and supported conclusions with open questions. | Native document structure. Explanatory content can be identical. |
| Historical/deconstructed tours | Real revision tables/snapshots; labeled synthetic scratch files in a separate directory or temporary repository, compared in stages and linked to real edits. | Manual/scripted composition. Complete hunk assignment and synthetic provenance need bookkeeping or validation. Never imply synthetic stages were real commits. |
| Previous/Next, outline, positions, explore/return, narration | CodeTour steps, tabs, document anchors, and OS speech; retain the guide while exploring elsewhere. | Composed approximation. Cross-mode restoration and speech synchronized with code focus need extra integration. |
| Details and audience assumptions; audience is a branch addition | Put scope, revisions, purpose, prerequisites, assumptions, and estimated time in the guide; maintain an evidence checklist. | Manual metadata. Exact hunk coverage requires a defined custom counting rule. Estimates/checklists do not prove understanding. |
| Explain / Question context; branch addition | Copy a frozen passage into a request with revisions, path/symbol/range, snippet, and exact question; use the existing conversation. | Manual equivalent. One-click packaging needs an editor command or script. |
| Writable repair and editor handoff | Retain snapshots separately; edit working files, run checks, inspect the result, and repair each artifact in its owning venue. | Native editing. Read-only enforcement depends on source mode or file safeguards. |
| Local links and portable HTML | Document anchors, pinned source links, and HTML embedding selected evidence with revision identities. | Links/export plus composition. Snapshots contain included evidence; full exploration requires a checkout or host. |

Supporting documentation: [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line),
[Git difftool](https://git-scm.com/docs/git-difftool),
[macOS speech](https://support.apple.com/en-gb/guide/mac-help/mh27448/26/mac/26),
and [Pandoc HTML generation](https://pandoc.org/MANUAL.html).

Bygone has the same distinction between repository-backed and snapshot sharing:
modern authored sources/manifests need the repository and Git objects, while
portable HTML freezes included evidence. Minimal/Full exports have different
exploration limits; neither supplies an arbitrary repository environment.

## A concrete baseline workflow

Inspect the intended committed range. These illustrative commands use `main`
and `HEAD`; substitute the desired refs. Index and working-tree differences
remain separate. The commands were not executed for this assessment.

```bash
BASE=$(git rev-parse main)
HEAD_REV=$(git rev-parse HEAD)
MERGE_BASE=$(git merge-base "$BASE" "$HEAD_REV")
git diff --name-status "$MERGE_BASE" "$HEAD_REV"
git diff --stat "$MERGE_BASE" "$HEAD_REV"
git diff "$MERGE_BASE" "$HEAD_REV"
git log --reverse --oneline "$MERGE_BASE..$HEAD_REV"
git status --short
```

Put the explanation in the existing PR/MR or a local guide:

```text
Expectation: link to the agreed requirement
Scope: base/head IDs and complete changed-file list
Reading order:
  1. Input handler — exact revision + path + symbol/lines
  2. State transition — same evidence locator
  3. Consumer / cleanup — same evidence locator
  4. Behavioral test — assertion + actual run result
For each step: claim, evidence, relationship to the next step
Boundary cases: what to investigate independently
Unresolved: missing evidence or undecided requirement
Question handoff: quote + revision + locator + exact question
```

For cancellation, this connects request handling, retry waiting, cleanup, and
the behavioral test. For compatibility sequencing, add a real revision table.
For a conceptual explanation, add explicitly synthetic snapshots. A reviewer
can leave the guide, investigate a counterexample, and discuss findings in the
existing venue. An agent can prepare or inspect the same evidence pack.

Implementation owns behavior; maintained docs own current guidance; agreed
requirements/design records own expectations; PR discussion owns proposal
rationale and decisions; test/CI output owns observed runs. A guide selects and
sequences evidence. Repair gaps in their owning artifacts. An answer with no
saved edits, an unresolved decision, or direct inspection without a guide can
complete the job.

Persistence is optional. A disposable reading aid may suffice; a historical
guide can stay pinned; a current-system guide incurs maintenance obligations.
Resolving anchors do not ensure the explanation remains accurate. Avoid a
parallel requirements authority, review inbox, or knowledge base.

## Positioning and the comparison to run

Bygone is a candidate integrated inspection and presentation workspace within
an existing engineering workflow. Direct comparison and history are complete
uses. Tours earn their place when sequencing and keeping evidence connected
reduce the reader's work enough to justify preparation and upkeep.

Relationship-heavy changes, including some agent-produced changes, are plausible
cases to test. Inspecting one's branch and then walking a reviewer through it
is a plausible adoption path. Neither is established audience research.

Use equivalent explanatory content and evidence across three conditions:

1. Clear implementation, maintained docs, and a good PR explanation.
2. The same baseline plus a short reading order and ordinary code links.
3. The same explanation/evidence presented through Bygone.

Include straightforward changes where a tour should offer little benefit.
Use comparable readers and rotate task/order to reduce familiarity effects.
Measure correct behavioral explanation, boundary-case prediction, decisive
lookup, retained context during detours, missed defects, and unsupported claims.
Count author preparation, reviewer effort, navigation errors, and maintenance.
Agent-generated content still costs inspection and upkeep. Better writing alone
would not establish a viewer advantage; coverage, completion, or satisfaction
cannot substitute for understanding.

Compare ordinary agent handoffs with headless tour-derived paths separately,
using equivalent requirements, repository access, tools, and budgets. Measure
verified findings, omissions, accepted unsupported claims, and investigation
cost. Human benefits do not automatically imply agent benefits.

If ordinary links perform as well at lower total cost, prefer that workflow.
A small trial can identify promising cases and failure modes; it cannot establish
market demand or statistical certainty.

## Confidence and verification limits

Confidence is **high** that the stated jobs have credible alternative workflows,
**moderate** that the composed alternatives are practical in every case, and
**moderate** that the integrated-workspace positioning fits Bygone's inspected
capabilities. End-to-end trials and measured total effort or error rates could
change those assessments. The map establishes no job that demonstrably requires
Bygone, and the discussion establishes no measured adoption advantage.

This assessment used the planning map, [product surface](https://github.com/davidmashburn/bygone/blob/main/docs/product-surface.md),
[tour format](https://github.com/davidmashburn/bygone/blob/main/docs/change-tour-format.md), README, selected code, and primary tool
documentation. It did not run the apps or alternative workflows, rerun runtime
tests, benchmark review speed, conduct reader trials, or establish demand.
Structural anchors identify evidence; coverage counts references or assignments.
Neither establishes implementation correctness, complete review, or comprehension.
