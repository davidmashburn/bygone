# Changelog

## Unreleased

## 0.8.10

- Fixed directory history and branch review materialization when a tree contains git submodule/gitlink entries, such as vendored nested repositories

## 0.8.9

- Made directory-history and multi-directory drill-downs jump to the first changed line, including after asynchronous diff computation
- Added standalone smoke coverage that verifies an off-screen first change becomes visible in both panes

## 0.8.8

- Fixed standalone, Git difftool, directory-history drill-down, web, and VS Code comparisons so their background diff worker loads from the correct host-resolved URL
- Added standalone smoke coverage that requires real worker-computed changes for two-file comparisons and directory-history drill-down

## 0.8.7

- Refined tour narration controls with clearer playback state, sentence-level skipping, and consolidated play/pause behavior
- Allowed narration skips to continue across adjacent tour steps and slides while preserving paused playback
- Improved tour and comparison toolbar controls, including clearer disabled word-wrap feedback

## 0.8.6

- Added optional authored-tour `windowTitle` labels and context-aware desktop and VS Code window titles
- Fixed tour presenter windows so authored `windowTitle` values appear in the native title instead of staying on the default `Bygone Tour` label

## 0.8.5

- Fixed Homebrew cask `bygone` CLI launch on Apple Silicon by routing through a bundle-aware launcher script inside the app
- Documented the macOS **“app is damaged”** workaround for unsigned desktop downloads (README, releasing docs, PR Tour Guide skill)

**macOS install:** Desktop builds are unsigned. If Gatekeeper reports the app is damaged, run `xattr -cr /Applications/Bygone.app` then open the app.

## 0.8.4

- Clarified PR Tour Guide skill install commands for project scope and agent-specific global installs
- Documented PromptScript-safe installation (`-y` without bare `-g`) to avoid spurious global-install failures from the skills CLI

## 0.8.3

- Fixed tour anchor gutter markers so active and persistent anchors are visibly rendered by Monaco, including after switching files in stacked tours
- Documented agent skill installation with `npx skills add davidmashburn/bygone -s pr-tour-guide`
- Expanded the PR Tour Guide skill with Bygone install instructions for Homebrew, npm, GitHub Releases, and source checkouts
- Included `skills/` in the `@davmash/bygone` npm package so the skill ships with CLI installs

## 0.8.2

- Added persistent tour anchor gutter markers across two-way and stacked-diff scenes, including every applicable step on the open file
- Added click-to-jump navigation from tour anchor markers back to the matching tour step

## 0.8.1

- Added familiar multi-cursor, selection, line, comment, indentation, folding, drag-and-drop, and context-menu editing across Bygone's two-way and multi-panel editors
- Added source-aware Monaco models and bounded syntax support while preserving comparison state, model disposal, tour rendering, and connector geometry
- Returned `Cmd/Ctrl+Alt+Up/Down` to Monaco's cursor controls and added change navigation through `F7`, `Shift+F7`, and simultaneous `Cmd/Ctrl+Shift+Up/Down`
- Added standalone Selection and Lines menus backed by allowlisted native Monaco actions
- Added action-oriented hover tooltips with current keybindings across comparison, history, file, search, tour, and sidebar navigation controls

## 0.8.0

- Added full-surface search across visible panes, comparison panels, unopened change-set files, file history, authored tours, and repositories, plus previewable safe repository replacement
- Made authored tours native `.bygone` documents with repository discovery, direct desktop opening on macOS, multiple presentation windows, persistent anchor markers, focused multi-panel navigation, and resizable readable layouts
- Moved VS Code comparisons into independent, restorable editor tabs with unsaved-document support, contextual commands, editable document bridging, and active file history
- Simplified desktop discovery and menus, clarified panel mutability, and hardened tour focus restoration, deep-file transitions, performance, and narrow layouts

## 0.7.1

- Fixed the standalone npm package so the installed `bygone` command includes its tour coverage runtime
- Made Homebrew release staging update formula and cask versions and declare the cask's macOS requirement

## 0.7.0

- Expanded directory comparison into an N-panel workspace with asynchronous diff computation, drill-down, and complete file navigation
- Added merge-base branch review with rename pairing, binary and image comparison, and consistent navigation across Git workflows
- Improved semantic highlighting, structural replacement matching, line-click selection, connector rendering, and multi-panel interaction consistency
- Added generated shell completions, desktop CLI installation, local rebuild/install automation, linting, and renderer bundle budgets
- Added authored, code-connected change tours, bounded LLM context, coverage reporting, stacked and deconstructed explanations, the PR Tour Guide skill, and independent narrative and file navigation
- Added refreshable sessions, pane-local find, persistent line wrapping, resizable sidebars, and horizontal multi-panel scrolling
- Adopted the crisp-hybrid Bygone icon and strengthened release packaging across npm, VS Code, desktop, and Homebrew artifacts
- Added a [guided 0.7 release tour](./tours/v0.7.bygone) covering the complete range from `v0.6.3`

## 0.2.0

- Added working tree vs `HEAD` as the newest git file history step
- Added GitHub Actions release checks
- Added scoped npm packaging and dry-run validation
- Added desktop app icons for packaged builds
- Split desktop packaging targets and made macOS DMG packaging the default

## 0.1.0

- Added editable two-way flowing diff rendering
- Added inline and line-level change highlighting
- Added git file history navigation with commit-by-commit stepping
- Added private/pre-release packaging metadata and release documentation
- Renamed the project from Melden to Bygone and updated the extension id, CLI, and difftool entrypoints
- Kept the product surface focused on diff and history workflows
