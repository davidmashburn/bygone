# Release Plan

## Goal

Ship Melden as a private or limited external VS Code extension release that is stable enough for real comparison work, while keeping the three-way merge path explicitly experimental.

## Current Readiness

- Two-way diff is the release candidate feature.
- Git file history navigation is usable, but still narrow in scope.
- Three-way merge is demo-quality and should not be marketed as production-ready.

## Release Scope For `0.1.0`

- Ship two-way compare
- Ship compare-with-selected
- Ship git file history viewer
- Keep three-way merge labeled experimental
- Package as `.vsix` for manual install

## Must-Fix Before Public Marketplace Release

1. Decide publisher identity and extension branding.
   The manifest still needs final publisher metadata and a proper extension icon.

2. Decide licensing.
   The repo is currently marked `UNLICENSED`. That is fine for private use, but not for an open/public release unless intentional.

3. Add extension icon and marketplace polish.
   The listing needs an icon, tighter description text, and likely a shorter feature-oriented README opening section.

4. Add smoke coverage for extension host behavior.
   Current tests cover diff engine logic, but not command registration, webview boot, or git-history command flow.

5. Validate packaging end to end.
   Build a `.vsix`, install it into a clean VS Code profile, and verify Monaco/webview assets load correctly from the packaged extension.

## Recommended `0.1.0` Validation Pass

1. Compare two arbitrary local files.
2. Compare with selected from Explorer context menu.
3. Use editable two-way diff and verify live recomputation.
4. Open git history on a tracked file and page older/newer through several commits.
5. Verify the webview loads after a fresh VS Code restart.
6. Install from packaged `.vsix` in a clean profile and repeat the checks above.

## Recommended Post-`0.1.0` Work

1. Add working tree vs `HEAD` as the newest history step.
2. Improve git-history support for renames and merge commits.
3. Add save/apply flows for edited panes where appropriate.
4. Replace the current experimental three-way merge with a more defensible merge engine.
5. Add CI for compile, tests, and packaging.

## Suggested Release Sequence

1. Finalize publisher, icon, and license.
2. Run `npm test`.
3. Package with `npx @vscode/vsce package`.
4. Install the `.vsix` in a clean profile.
5. Fix any packaging-only issues.
6. Tag `0.1.0`.
7. Publish privately or to the Marketplace, depending on the licensing/publisher decision.
