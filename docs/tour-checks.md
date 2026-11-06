# Checks & evidence

The main tour explains why the change exists, what changes, and the decisions
that matter. Routine verification belongs in the collapsed **Checks & evidence**
disclosure under Tour details. It is outside the reading sequence and narration.

Version 7 source and compiled tours accept optional `details.checks` at the root
and within each independent tour (`tours.historical` or `tours.deconstructed`).
Each scope describes its own evidence; an independent tour does not inherit the
root's checks. The compiler and exports preserve authored checks without deriving
statuses from compilation, coverage counts, or generator attribution.

```yaml
version: 7
# Other required tour fields omitted from this fragment.
details:
  checks:
    provenance:
      status: verified
      summary: The cited endpoint revisions and source anchors were inspected.
    claims:
      status: partial
      summary: The request path is supported; retry behavior remains uncertain.
      details: See [the supporting analysis](https://example.test/analysis).
    behavior:
      status: not-checked
      summary: Runtime behavior was not exercised.
```

The five categories always appear in the reader, including on older tours:

| Category | What the author records |
| --- | --- |
| `provenance` | Source identity, revision range, and evidence origin checked |
| `claims` | Which explanatory claims were checked against evidence |
| `behavior` | Tests, runtime observations, and checks skipped |
| `coverage` | Scope examined, omissions, and completeness limits |
| `uncertainty` | Open questions, assumptions, and contradictory evidence |

Each supplied category has one `status`, a nonempty concise `summary`, and
optional nonempty supporting `details`. Supporting prose accepts the reader's
safe inline links (`http`, `https`, or validated `bygone` links); authored HTML
and unsafe link targets remain text. Source links are preserved in exports, so
use destinations appropriate for the intended audience.

| Status | Meaning within the summary's stated scope |
| --- | --- |
| `verified` | The author performed the described check and found supporting evidence |
| `partial` | Some evidence was checked, with a stated remaining limit |
| `not-checked` | The described check was not performed |
| `not-applicable` | The check does not apply, with the reason in the summary |

These statuses are authored assertions, not independent approval or a guarantee
of correctness. Use `verified` only for the bounded check actually performed.
Missing categories display **Not checked** and **No check supplied**; they never
inherit a passing status. Omitting `checks` entirely is valid and has the same
honest default. Authors need not repeat a fixed checklist in every source.

Malformed objects, unknown categories or fields, unsupported statuses, and empty
prose are rejected by source and compiled validation. `checks` requires version 7;
older tours without the field remain supported.
