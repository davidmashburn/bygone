# Project planning

Long-lived product ideas and implementation plans live on the orphan
`project-planning` branch, not on `main`. The branch intentionally has no
shared commit history with the development branch so planning material can
stay alongside the project without becoming part of shipped source or the
primary README.

When adding or revising planning material:

- Use a separate worktree for `project-planning`; do not merge the orphan
  branch into `main`.
- Put early, unresolved concepts in `ideas/` and actionable, scoped proposals
  in `plans/`.
- Keep implementation work based on `main`. Copy or adapt an approved plan
  into implementation context when needed instead of merging branch history.
