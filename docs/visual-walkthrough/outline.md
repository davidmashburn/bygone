# A visual guide to Bygone

Audience: someone opening Bygone for the first time, with enough detail for an
existing user to discover the larger workflows. Screenshots show Bygone 0.9.9
plus the image-step support added for this guide. This is a product walkthrough,
not a review of the implementation commits.

## 1. Compare what is in front of you

1. Two files: read paired changes, additions, whitespace, and connector ribbons.
2. More than two versions: use the active pair and Visible panels together.
3. Directories: start with the inventory, then drill into a changed file.
4. Find: search the comparison without losing the current evidence.

## 2. Ask how it got here

5. Directory history: orient yourself with Files and Commits.
6. File history: keep exact revisions visible while following one file.
7. Branch review: use the overview to choose a reading order.

## 3. Turn exploration into an explanation

8. Read a tour: outline, continuous narrative, and corresponding evidence.
9. Follow a step: source focus and the expandable sticky scene heading.
10. Deconstructed mode: distinguish explanation stages from real commits.
11. Leave and return: Files, Commits, History, Compare, and Return to tour.
12. Author a tour: the editable handoff prompt and the CLI validation workflow.

## 4. Take the work with you

13. Share: document-section links and a portable HTML export.
14. VS Code: contextual comparison near the editor, with desktop handoff.
15. CLI: choose a launch form appropriate to the question.

## Capture and assembly contract

- Write the narrative before capturing; reconcile it against what each screen actually shows.
- Use the same dark theme and consistent viewport where practical.
- Capture real rendered Bygone UI; do not paint hypothetical controls into images.
- Store the images here with capture provenance and reproducible commands.
- Prefer surrounding prose to annotations that cover code or controls.
- Commit screenshots before pinning their exact Git revision in the tour.
- Display one screenshot per authored step, grouped by the four arcs above.
- Validate, compile, inspect every image step, and test a portable HTML export.

## Required product support

Tour steps need an optional image attachment resolved from the pinned Git range.
The compiler must embed PNG bytes so the compiled tour and HTML export retain the
image without a working tree or external image server. The presenter should show
the image in its evidence area, with accessible alternative text, and restore
normal code evidence when navigating away. Reject unsupported or invalid assets.
