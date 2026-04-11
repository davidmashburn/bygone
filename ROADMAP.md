# Roadmap

Bygone is past the prototype stage. The next work should focus less on adding random capability and more on making the existing product reliable, distributable, and clearly differentiated.

## 1. Stabilize The Core Diff Experience

This is the highest-leverage work.

- tighten scroll sync and anchor behavior in more edge cases
- test larger files and ugly edit patterns
- harden inline and line highlight correctness
- make sure standalone, web, and VS Code all behave the same

Success criterion:

- the two-way diff feels reliable enough that the renderer stops being the thing you notice

## 2. Finish Packaging And Distribution

The code is ahead of the release surface.

- choose a license
- verify npm publishing flow from the staged `@davidmashburn/bygone` package
- validate desktop artifacts on Windows and Linux, not just macOS
- verify clean install paths for:
  - VS Code extension
  - standalone app
  - npm launcher
- push the rename commit and align the local repo folder name if desired

Success criterion:

- a user can install and launch Bygone without repo-local handholding

## 3. Make History View A Flagship Feature

This is the most differentiated part of the product.

- add working tree vs `HEAD` as the newest history step
- improve handling of renames and odd git history cases
- consider a compact overview or timeline for stepping through commits
- make history mode feel first-class, not “diff mode plus arrows”

Success criterion:

- the answer to “why use Bygone instead of a normal diff tool?” is obviously “history”

## 4. Decide What Editing Means

Editable panes are powerful, but the product behavior is still ambiguous.

If Bygone is a real editor:

- make save/reload/dirty-state behavior fully predictable
- document it clearly
- test file-change conflict handling hard

If Bygone is mainly a viewer:

- consider making editing optional or clearly secondary

Success criterion:

- users understand whether edits in Bygone are exploratory or authoritative

## 5. Reassess Three-Way Merge

This is currently the weakest area.

- either invest in a more defensible merge engine
- or keep it clearly experimental and stop spending much roadmap energy there for now

Recommendation:

- deprioritize this until two-way diff and history are excellent

## 6. Add Real-World Validation

Use the tool more and let real usage drive the next fixes.

- package it
- use it on actual repositories
- collect the first ten annoying failures
- fix those before adding major new features

Likely findings:

- performance issues
- weird git cases
- command/UX friction
- install rough edges
- save/history confusion

## Suggested Milestones

### 0.1.1

- push rename
- choose license
- publish scoped npm package
- validate desktop packaging on Windows/Linux
- clean install docs

### 0.2.0

- working tree vs `HEAD`
- better history navigation UX
- more diff correctness hardening
- parity check across VS Code, standalone, and web

### 0.3.0

- decide whether editing is first-class
- either commit to save/apply workflows or reduce scope
- revisit three-way merge only after that

## Product Direction

Bygone should lean hard into “see how change happened,” not “yet another merge tool.”

That is where the product has actual identity now.
