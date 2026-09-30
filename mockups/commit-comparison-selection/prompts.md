# Commit comparison selection mockups

Generated with the built-in image generation tool. These are visual concepts, not implemented UI.

## Shared prompt

Use case: ui-mockup.
Asset type: high-fidelity desktop application concept image for Bygone, a Git diff and history tool.
Create one crisp, realistic flat UI screenshot, wide landscape 3:2 format. No device mockup, no perspective, no illustration, no decorative graphics, no watermark. Large readable typography, practical compact spacing.
Shared design: dark charcoal background #11131a, slightly lighter panels #191d27, thin gray borders, off-white text #eef1fa, muted gray metadata, restrained lavender #a99fff selection and buttons. Modern system sans-serif UI text, monospaced SHA and code. Native desktop titlebar reading "Bygone — Commit comparisons". Modes across top: "History", "Compare" (active), "Historical tour", "Deconstructed tour". Left commit list occupies around 28% of screen. Main area shows a credible two-pane code diff for "src/navigation.ts", with muted red removed lines on left and muted green added lines on right. Diff stays visible. Diff headings: "abc123 · Baseline" and "ghi789 · Tooltip polish"; short TypeScript code and line numbers, no dense tiny filler. Commit rows newest first, with these exact texts: "ghi789  Tooltip polish", "def456  Restore commit details", "cde345  Refine navigation", "abc123  Baseline". Under each show "Sep 30 · David Mashburn". The mechanisms in the option-specific request must be the unmistakable focus. Add a slim caption band outside the app at top for the exact option title and outside the app at bottom for the exact interaction explanation. This is a product design comparison, no marketing copy.

## 1 · Inspector + checkboxes

Output: `option-1-inspector-checkboxes.png`

Option-specific layout: Each commit row has a clear square checkbox at the left. Check only abc123 and ghi789. Independently highlight def456 in a subtler lavender outline as the inspected commit, its checkbox remains unchecked. Show a compact commit inspector beneath the commit list, with title "Restore commit details", SHA "def456", metadata "David Mashburn · Sep 30, 2026", full message "Keep commit inspection separate from revision navigation.", changed files "src/navigation.ts" and "web/host.js". Inspector actions "View changes" and "Add to comparison". Inspector must be a detail card, not another code diff. A selection tray at bottom of the main workspace, with heading "Comparison draft", two removable chips "abc123 ×" then arrow then "ghi789 ×", and lavender "Compare" button. The inspected def456 is NOT in the tray and NOT loaded in the diff. Top caption exactly "1 · Inspector + checkboxes". Bottom caption exactly "Click a title to inspect. Check a box to select. Compare applies the draft."

## 2 · Base / Target picker

Output: `option-2-base-target.png`

Option-specific layout: NO selection checkboxes. Above commit list show segmented control with "Set base" and "Set target", with Set target active. In commit list abc123 has a pill "BASE" and ghi789 has a pill "TARGET". def456 and cde345 have no assigned role. Beneath the list show concise commit details for the target ghi789: heading "Tooltip polish", metadata "David Mashburn · Sep 30, 2026", message "Explain anchored hunk coverage on hover and focus.", files "web/host.js" and "web/presenter.css". Across the bottom of the main workspace show a wide comparison builder with two equally weighted labeled cards "Base" with "abc123 · Baseline" and "Target" with "ghi789 · Tooltip polish", a right-pointing arrow between them, a small swap button with bidirectional arrows, and lavender "Compare" button. Show small hint "2 revisions · endpoint diff" above these cards. Prioritize the direct role assignment mechanism. Top caption exactly "2 · Base / Target picker". Bottom caption exactly "Choose a role, then click a commit. Compare the two endpoints."

## 3 · Selectable rows + info

Output: `option-3-row-selection-info.png`

Option-specific layout: NO selection checkboxes. Entire commit rows are large selection targets. abc123 and ghi789 rows have a lavender-tinted background, strong left selection stripe and a checkmark at right; all other rows are neutral. EVERY row has a separate clear circular "i" button at its far right, visually distinct from its selection indicator. def456 remains UNSELECTED but its "i" button is active and opens a compact anchored info popover beside the list over a small portion of the main diff. Popover title "Restore commit details", SHA "def456", metadata "David Mashburn · Sep 30, 2026", message "Keep commit inspection separate from revision navigation.", changed files "src/navigation.ts" and "web/host.js", and action "View changes". Popover can be closed with ×. In the footer of main workspace show heading "Comparison draft", removable chips "abc123 ×" then arrow then "ghi789 ×", and lavender "Compare" button. Include small text "2 selected". The info popover's def456 is NOT selected, NOT in the draft, and does NOT change the visible diff. Top caption exactly "3 · Selectable rows + info". Bottom caption exactly "Click a row to select. Click its info button to inspect. Compare applies the draft."
