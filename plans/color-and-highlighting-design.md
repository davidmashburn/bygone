# Color and highlighting design pass

## Status

Deferred design and research plan, captured 2026-10-12. No palette or replacement
treatment selected. Keep the current implementation until alternatives have
been evaluated; this plan does not start implementation.

## Goal and context

Make it immediately clear what changed, what the reader selected, and what
Bygone is drawing attention to, without making source text tiring to read.
Design the relationships between visual states before choosing individual colors.

The trigger was partial-word selection in dark mode: Monaco highlighted the
whole word with a fill that was difficult to distinguish from the selected
characters. Commit `ef1eed8` on `main` replaced occurrence fills with outlines.
The user's assessment: “don't love it, but it'll do for now.” Treat this as a
temporary mitigation, not approval of outlines as the final design language.

Confidence is high that overlapping states need a coherent design; confidence
in any specific palette or treatment is low until tested. A candidate that
passes contrast checks but still confuses selection with occurrences would
change the design, not be excused by its measurements.

## Scope and boundaries

Start with source reading and comparison: text/syntax, unchanged content,
line-level and inline differences, whitespace, selection, occurrence matches,
search results, current change, keyboard focus, active panel, gutters, and
connectors. Include tour evidence emphasis and adjacent controls where they
compete with these signals. Check Desktop, VS Code, and exported viewers.

Preserve semantic accuracy. Bygone currently uses green for one-sided content
and blue for paired replacements; one-sided does not necessarily mean added.
Reconsider the visual encoding without silently assigning it a new meaning.
Future move/copy markers are a compatibility consideration, not a feature to
implement in this pass.

Non-goals: a rebrand, general layout redesign, diff-algorithm changes, a theme
marketplace, new tour-authoring rules, or a broad accessibility certification.
Do not add a color preference for every state to avoid making a design decision.

## Research foundation

Use primary sources; record each useful finding, its application to Bygone,
and its limits. This is a starter bibliography, not a completed research review.

| Source | What it contributes |
| --- | --- |
| [WCAG 2.2: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) | Meaning must not depend on hue alone; investigate redundant cues such as placement, marks, or labels. |
| [WCAG 2.2: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Normal text generally requires 4.5:1 contrast; large text 3:1. Audit code and syntax tokens on their actual backgrounds. |
| [WCAG 2.2: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | Required component/state cues and meaningful graphics generally require 3:1 against adjacent colors. Determine applicability per cue; not every decorative tint needs this ratio. Thin outlines can remain hard to perceive despite nominal compliance. |
| [CSS Color 4: Oklab/OkLCh](https://www.w3.org/TR/css-color-4/#ok-lab) | Explore lightness, chroma, and hue systematically using a perceptual color space. Perceptual spacing does not itself prove contrast or accessibility. |
| [Material 3 color roles](https://m3.material.io/styles/color/roles) | Examine semantic roles and foreground/background pairs instead of isolated swatches. Borrow the method, not the product's palette. |
| [VS Code theme colors](https://code.visualstudio.com/api/references/theme-color#editor-colors) | Inventory distinct selection, occurrence, search, diff, and focus roles, including transparency constraints. Verify behavior against Bygone's installed Monaco version. |
| [NASA: Crew Interfaces, color coding redundancy](https://www.nasa.gov/reference/10-0-crew-interfaces-vol-2/) | Supports consistent encodings and additional cues for important information. Aerospace requirements are not automatically requirements for a code viewer. |

Extend this with research on visual search, figure/ground separation,
simultaneous contrast, color-vision differences, and the interaction of syntax
colors with background overlays. Separate empirical findings from design-system
conventions and aesthetic preference. Record study populations and tasks before
generalizing results to sustained code reading. Compare established diff/editor
tools for concrete interactions, not as proof that their choices are optimal.

## Work sequence

1. **Audit the current states.** Inventory tokens, inherited Monaco colors,
   CSS decorations, canvas connectors, opacity, and drawing order. Capture real
   examples from `media/script.js`, `media/windowTheme.css`, editor styles, and
   connector code; refresh paths when work begins. Identify duplicate meanings
   and accidental collisions. Include focused and inactive selections.
2. **Define roles and overlap rules.** For every signal, specify its meaning,
   scope, priority, and non-color cue. Decide which states may share a fill,
   which should use another channel, and what remains visible during overlap.
   Exact selection boundaries and keyboard focus must remain identifiable.
   Don't assume everything can be solved by assigning another hue.
3. **Prototype two or three materially different treatments.** Compare a
   restrained fill hierarchy, a mixed fill/edge/gutter approach, and a quieter
   secondary-match treatment, alongside today's baseline. Explicitly examine
   whether whole-word occurrence emphasis should remain active during partial
   selection. Avoid turning every word into a box. Prototype in real Monaco
   with representative content, not just a palette sheet.
4. **Evaluate accessibility and comprehension.** Calculate contrast after
   alpha compositing, including syntax text over overlapping decorations.
   Check grayscale and common color-vision-deficiency simulations, while
   recognizing that simulation is not user testing. Inspect high-contrast and
   forced-color behavior where supported. Test real displays at normal and
   enlarged text sizes. Use brief reader tasks to expose mistaken meanings.
5. **Choose and specify.** Record the evidence and tradeoffs; define semantic
   tokens, light/dark variants, host-theme behavior, overlap precedence, and
   fallback behavior. Convert the chosen design into a separate scoped
   implementation plan and meaningful renderer regression fixtures.

## Evaluation cases

| Situation | Reader must be able to tell |
| --- | --- |
| Partial-word selection with repeated identifiers | Exactly which characters will be copied; which whole words are merely related matches |
| Selection across an inline replacement or whitespace-only change | Selected extent and the location of the underlying change |
| Search result inside the current change, with occurrence highlighting | Current search hit versus other hits, occurrences, and change navigation |
| Keyboard navigation between two or more panels | Which panel has focus and where the active selection remains |
| Tour evidence emphasis over a changed line | What the tour points to versus what the comparison reports |
| Dense syntax-colored code, prose, and YAML | Text remains readable and incidental matches do not dominate |

Run the critical cases in light, dark, and supported high-contrast themes,
including inactive windows and multi-panel views. Use long selections, wrapped
lines, small punctuation, and low-chroma syntax tokens as stress cases.

## Completion criteria for the design pass

- A concise research synthesis links recommendations to evidence and flags
  unresolved questions; no claim of a universally optimal palette.
- A role/overlap matrix and interactive alternatives make tradeoffs reviewable.
- Contrast measurements identify actual foreground/background pairs, layering,
  criterion applicability, and failures; passing numbers alone do not decide.
- Reader walkthroughs ask “what is selected?”, “what changed?”, and “where does
  the next action apply?” Record errors, hesitation, and visual fatigue separately
  from aesthetic preference. Disclose who participated and what was not tested.
- The recommendation resolves the original ambiguity without replacing it with
  clutter or hiding meaningful differences. Unresolved failures stay explicit.
- A short implementation scope covers shared tokens, host integration, and
  regression cases. Main stays unchanged until that design is selected.

## Related planning

- [Editor comfort](editor-power.md)
- [Find behavior](find-behavior.md)
- [Text-block move tracking](text-block-move-tracking.md)
- [Archived chrome design](../ideas/archived-ui-chrome-redesign-2026-04/README.md)
  — historical context, not a palette constraint.
