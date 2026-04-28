---
name: Codex task
about: Self-contained task ready for an AI coding agent (Codex / Claude Code / Cursor)
title: "Phase X.Y: <short title>"
labels: ["codex-ready"]
---

<!--
HOW TO USE THIS TEMPLATE
1. Fill in every section. Do not leave placeholders.
2. The agent reads this issue + the repo-root AGENTS.md and nothing else.
3. If a section does not apply, write "N/A" rather than deleting it — agents can be confused by missing sections.
-->

## Context

Why this task, what it unblocks. One paragraph.

## Read first (in order, before writing code)

- `path/to/file.ts:lines` — reason this file matters
- `path/to/other.ts` — reason
- External doc URL — instruction (e.g. "WebFetch this and read the Tool Use section")

## Goal

One paragraph describing what success looks like. Concrete, no hand-waving.

## Out of scope (do NOT do these)

- Specific over-reaches to avoid (e.g. "do not refactor unrelated routes")
- Things that look related but belong in a different issue

## Steps

1. First concrete change
2. Next concrete change
3. ...

## Anti-patterns

- Don't X because Y
- Don't Z because W

## Acceptance

Use shell-runnable checks where possible.

- [ ] `cd apps/web && npm run build` succeeds
- [ ] `<command>` output matches `<expected>`
- [ ] `grep -r "<old-string>" --exclude-dir=node_modules --exclude-dir=.next` returns no results
- [ ] No regressions in `<related route or page>`

## Branch

`phaseX/short-slug`

## Commit message

```
type(scope): summary

Body explaining the why, not the what.
```

## PR title

`Phase X.Y: <title>`

## Dependencies

- Blocked by: #N (if any)
- Blocks: #M (if any)

---

**Before starting, read `AGENTS.md` at repo root for global rules and architecture.**
