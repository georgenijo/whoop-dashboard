---
name: decisions
version: 1.0.0
description: |
  Append architectural, scope, or process decisions to the running Decisions Log
  at docs/decisions/DECISIONS.md (in the active project repo). Use whenever a
  decision is made in conversation that future sessions or collaborators need to
  know about — phase ordering, library choices, deferred work, scope cuts, locked
  tradeoffs. Subcommands: add, supersede, list, show.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# decisions — Running decisions log for the active project

## Why this exists

Decisions made in conversation evaporate. Memory captures user/feedback/project facts but isn't structured for chronological architectural history. ADR-style one-file-per-decision works for big locked decisions but is heavy for the constant stream of small calls (scope cuts, ordering choices, deferred items).

This skill maintains a single running log — `docs/decisions/DECISIONS.md` in the project repo — where every meaningful decision gets a short timestamped entry. Newest at top. Each entry has: date, decision, rationale, status, references. Future agents reading the repo find the log via `AGENTS.md`; future humans find it via the `docs/decisions/` directory.

The log is **versioned in the repo, not in memory** — it's part of the project's permanent record, not the user's personal context. Memory files describe the user; this log describes the project's evolution.

## When to invoke

Call this skill whenever a decision lands in conversation that meets any of these:

- **Architectural choice** — library X over Y, pattern A over B, table shape, file layout
- **Scope cut or expansion** — feature deferred, sub-issue created, work pulled forward
- **Phase ordering** — sequencing decisions for multi-phase work
- **Tradeoff resolution** — picking between options after weighing them
- **Deferral with reason** — "we're not doing X right now because Y"
- **Convention adoption** — new pattern that should apply going forward
- **Doc supersession** — marking a previous direction obsolete

Do NOT invoke for:
- Trivial implementation details captured in commits/PRs
- Bug fixes (the commit is the record)
- One-off tactical choices with no downstream impact
- Re-statements of what's already in code or AGENTS.md

If you're unsure, ask: would the next session need this to make sense of why something is the way it is? If yes, log it. If the code or git history fully captures it, skip.

## File location

`docs/decisions/DECISIONS.md` at the active project repo root. If the file doesn't exist, create it with the header template below before adding entries.

Project ADR files (`docs/decisions/YYYY-MM-DD-*.md`) coexist — they hold deep one-off rationale for big locked decisions. The running log references them when relevant.

## Entry format

Each entry sits at the **top** of the file (newest first) under the running header. Use this exact template:

```markdown
## YYYY-MM-DD: <one-line decision in active voice>

**Decision:** <2–4 sentence statement of what was decided>

**Rationale:** <why this over the alternatives; cite the constraint or evidence>

**Status:** active | deferred | superseded by <date or ref>

**References:** <#issue, #PR, file path, ADR link — comma-separated>

---
```

Rules:
- Keep entries terse — one screen each, max. If you need more, write an ADR and reference it from the entry.
- Use absolute dates. No "yesterday" / "last week" — date math fails across sessions.
- Status `active` = currently in force. `deferred` = decided not to do, with reason. `superseded` = explicitly replaced by a later entry (cite the date).
- When superseding, do NOT delete the old entry. Flip its status to `superseded by YYYY-MM-DD` and write the new one at the top. The log is append-only.
- Reference IDs (`#317`, `PR #318`, `docs/architecture-scalable.html`) where possible so readers can verify.

## File header template

When creating `DECISIONS.md` for the first time:

```markdown
# Decisions Log

Running log of architectural, scope, and process decisions for this project. Newest entries at the top. Each entry is short — for deep rationale on a single locked decision, write an ADR alongside in `docs/decisions/YYYY-MM-DD-*.md` and reference it here.

Maintained via the `/decisions` skill. See `~/.Codex/skills/decisions/SKILL.md` for the entry format and invocation rules.

---

```

## Subcommand behavior

The skill is invoked by the user typing `/decisions <subcommand>` or by the model deciding a decision-worthy moment occurred.

### add (default)

Append a new entry at the top. If `DECISIONS.md` doesn't exist, create it with the header first. Read the file before writing so you preserve everything below. Use the Edit tool to insert the new entry just below the `---` separator after the header.

Briefly confirm to the user: one line stating what was logged.

### supersede

Flip an existing entry's status from `active` to `superseded by YYYY-MM-DD`, then add a new entry at the top. Two edits, one tool turn each.

### list

Read the file and show the user the last 5–10 entry headers (the `## YYYY-MM-DD: ...` lines) with status tags. Don't dump full bodies.

### show <date-or-keyword>

Read the file and surface the matching entry's body to the user. If multiple match, list options.

## Anti-patterns to avoid

- **Logging trivia.** "Renamed variable X" is not a decision. The diff is the record.
- **Restating the obvious.** If the code already says "we use libsodium," don't log "we decided to use libsodium." Log it if a future reader would ask *why* (e.g. "tweetnacl over libsodium-wrappers because Python parity").
- **Speculative future plans.** This log is for decisions that have been made, not for ideas. Use the project memory or a tracking issue for ideas.
- **Editing past entries.** The log is append-only. Flip status, write a new entry. Never rewrite history — the trail of decisions is the value.
- **Duplicate entries.** Before adding, scan recent entries (top 5) for the same topic. If a decision is being refined, supersede the prior one instead of stacking.

## Initialization checklist

If `docs/decisions/DECISIONS.md` does not exist in the active repo:

1. Create the file with the header template above
2. Add the current session's decision(s) as entries at the top
3. Add a one-line pointer to the file in the project's root `AGENTS.md` under "Working notes" or similar so future agents find it
4. Commit the changes with a Conventional Commits subject (`docs(decisions): initialize running decisions log` or similar)

## Commit hygiene

When this skill creates or updates `DECISIONS.md`:
- Commit on a new branch or directly to main per the project's normal flow — match what was happening before the skill was invoked
- Subject under 50 chars: `docs(decisions): log <one-line summary>`
- No Co-Authored-By, no AI attribution (project convention per AGENTS.md)
- One decision per commit when possible; batch only if they were made together in the same conversation
