---
description: Create plan files with checkbox subtasks in .opencode/plans
agent: plan-writer
subtask: true
---

# Plan

Arguments: `$ARGUMENTS`

`$ARGUMENTS` is the feature or task description to be planned. It may be prefixed with an
explicit plan slug, given as the first word followed by a colon:

- `<plan-slug>: <feature or task description>` — use that slug for the plan directory
- `<feature or task description>` — derive the slug from the description
- empty — print the usage line and stop

## Instructions

Follow the Plan Writer workflow in your agent instructions.

1. Resolve the plan slug: the explicit slug before the colon when given, otherwise a 2–5 word
   kebab-case slug derived from the description. If `.opencode/plans/<plan-slug>/` already
   exists, append a numeric suffix (`my-plan-2`) and use the first free path.
2. Split the work into ordered tasks, one per file-under-ownership boundary, numbered from `1`.
   Task `1` is the foundation; mark real dependencies with `Depends on: task <m>`.
3. Write each task to `.opencode/plans/<plan-slug>/<n>-<task-slug>.md` using the plan file
   template from your agent instructions: title, `Plan:` / `Depends on:` line, `## Subtasks`
   checkbox list, and `## Files` list.
4. Ensure `.opencode/plans/` is gitignored, but only inside a git work tree (`git rev-parse
   --is-inside-work-tree` must succeed; otherwise skip this step): run
   `git check-ignore -q .opencode/plans`; if it exits non-zero, append the single line
   `.opencode/plans/` to `.gitignore` with `edit`/`write` (create the file if missing). Never use
   shell redirection, and never add the line twice.
5. Write no files outside `.opencode/plans/` and `.gitignore`. Do not implement the plan, do not
   run builds or tests, do not commit.

If `$ARGUMENTS` is empty, print exactly:

```
Usage: /plan [<plan-slug>:] <feature or task description>
```

and stop without creating any file.

## Output

The final output is the list of plan files written, plus the gitignore state:

```
Plan: <plan-slug>
Gitignore: already covered | added .opencode/plans/ to .gitignore | created .gitignore | skipped (not a git repository)
Files:
.opencode/plans/<plan-slug>/1-<task-slug>.md
.opencode/plans/<plan-slug>/2-<task-slug>.md
```
