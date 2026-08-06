# Project planning

This orphan branch is a lightweight planning space for ideas, proposals, and
project plans that should live alongside the repository without becoming part
of `main`.

## Structure

```text
ideas/
plans/
```

- [`ideas/`](ideas/README.md) contains early-stage concepts, possibilities,
  and questions worth preserving.
- [`plans/`](plans/README.md) contains more developed plans with goals, scope,
  decisions, and next steps.

Markdown is the primary file format. Keep documents self-contained and link
between related ideas and plans when useful.

## Organization guidance

The top-level directories represent the document's stage: an item starts in
`ideas/` and can move to `plans/` when it has enough shape to act on. Use the
following secondary organization only when it makes navigation easier:

- **Category:** Add a category subdirectory when a directory becomes crowded,
  for example `ideas/editor/` or `plans/release/`. Prefer a small, stable set
  of categories over a new folder for every topic.
- **Date:** Prefix files with `YYYY-MM-DD-` when chronology matters, such as
  meeting notes, decision records, or dated snapshots. Omit the date for
  living documents that are continuously updated.
- **Both:** Use both category and date for high-volume, time-based material,
  for example `plans/release/2026-08-06-publishing-workflow.md`.
- **Other useful signals:** Use a concise status heading such as `Draft`,
  `Exploring`, or `Ready` inside the document rather than encoding status in
  folder names or filenames.

Start with descriptive filenames and the two primary directories. Introduce
categories or date prefixes when the collection's size or history justifies
them.

## Branch notes

`project-planning` intentionally has no shared commit history with `main`.
Changes here are planning artifacts unless they are deliberately copied or
adapted into the main development history.
