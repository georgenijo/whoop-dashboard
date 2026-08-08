# Phase E.2 — Orchestrator Handoff (Issue #334, BYOK Anthropic key)

Starter context for a fresh Claude session that will drive issue [#334](https://github.com/georgenijo/whoop-dashboard/issues/334) through the same orchestrator pipeline used for #333 (Phase E.1, merged in #336 / commit `7ebb458`).

## Mission

Drive PR #334 (Phase E.2 — BYOK Anthropic key, paste/validate/store/clear) to a **flawless** state: zero reviewer callouts (no blockers, warnings, or nitpicks) before opening the PR. Sequential — this is the only issue you're tackling. Do NOT start #335 after merge unless explicitly told.

## Pipeline pattern

You are the **lead orchestrator**. You spawn and control:

1. **Plan agent** (`subagent_type: "Plan"`, read-only) — produces step-by-step plan with file paths, function signatures, commit boundaries, gotchas, out-of-plan list, reviewer self-check list.
2. **Implementer agent** (`subagent_type: "general-purpose"`) — executes the plan in the worktree. Commits frequently (conventional commits). No push, no PR. Self-checks against the reviewer list at the end.
3. **Reviewer agent** (`subagent_type: "whoop-reviewer"`, read-only) — scans the diff vs `origin/main` and the new files. Reports findings under Blockers / Warnings / Nitpicks. Carries forward deferred findings explicitly.
4. **Fix-up implementer** — addresses every reviewer finding (warnings + nitpicks). Iterate review → fix → review until reviewer says "Ready to open the PR."

Only then push branch + `gh pr create`. After opening, pull CodeRabbit comments via `gh api repos/<owner>/<repo>/pulls/<n>/comments`. If anything new lands, fix-up and push again.

## Hard rules

- Zero callouts gate: PR opens only when the reviewer agent has nothing to say across all severity levels.
- **No `Co-Authored-By:` lines** in commit messages. **No AI / Claude / Anthropic attribution** on commits, branches, PR titles, or PR bodies.
- Sequential — wait for user to merge before the next issue.
- No scope creep beyond the issue. E.3 is out of scope (banners are a separate ticket).
- `whoop-reviewer` is the source of truth for "clean" — not the implementer's self-check.
- When reviewer notes a finding as "pre-existing" or "observational," document the rationale to keep that decision sticky across passes.

## Worktree + branch

```bash
git worktree add /Users/george-mac-mini/Documents/code/whoop-dashboard-issue-334 \
  -b feat/334-byok-anthropic-key origin/main
cd /Users/george-mac-mini/Documents/code/whoop-dashboard-issue-334/apps/web && npm ci
```

`node_modules` is per-worktree. Run `npm ci` upfront (or in the background) so `npm run build` / `npm test` work later without delay.

## Issue #334 recap

- New Settings section under Coach with anchor `id="coach-byok"`.
- Three UI states: default (env key), add personal key (paste + validate), set (masked + clear).
- Endpoints: `GET/POST/DELETE /api/me/anthropic-key`. POST probes via `client.models.list({ limit: 1 })`. 401 from probe → `{ ok: false, code: "invalid_key" }`. Success → encrypt + persist via existing `upsertUserSettings({ anthropic_key })`.
- Coach loop resolves the effective API key ONCE per request (after `requireAuth`). Precedence: user BYOK → env → 503. Pass resolved key into `runAnthropicSdk` and `titleChatThread` as a param.
- New `BadApiKeyError` thrown when SDK returns `APIError && status === 401`. Single check — no disjunction with `AuthenticationError`.
- Insights regen path becomes BYOK-aware (same resolver).
- Out of scope: the bad-key banner UI on `/coach` is #335. Plumb the SSE/HTTP error event (`kind: "bad_api_key"`) only.

Read the full issue body for the canonical spec: `gh issue view 334 --repo georgenijo/whoop-dashboard`.

## Infra from #336 you can reuse

- `apps/web/src/lib/db/user_settings.ts` — `getUserSettings`, `upsertUserSettings`, `setCoachGoals`, `markOnboarded`, `setTzIfUnset`. Same `undefined = leave, null = clear, value = set` pattern. `anthropic_key` and `anthropic_key_version` already in schema (Phase A) — encrypted column. No new ALTERs needed for this issue.
- `apps/web/src/lib/coach/goals.ts` — canonical goal IDs/labels. Not directly relevant to E.2 but shows the "single source of truth" extraction pattern.
- `apps/web/src/lib/tz.ts` — `sanitizeTimezone` example. Not relevant to E.2, just style reference.
- Reviewer found the `markOnboarded` / `setTzIfUnset` atomic SQL pattern (`INSERT ... ON CONFLICT DO UPDATE SET ... RETURNING`) — reuse if you need similar set-once semantics.

## Smoke verification (mandatory before PR)

Use the **`whoop-dev` skill** + **`agent-browser` CLI** (replaced the old Chrome MCP — see `docs/agent-context/pipeline.md` and `CLAUDE.md`).

### Spin up

```bash
RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh /Users/george-mac-mini/Documents/code/whoop-dashboard-issue-334)
URL=$(echo "$RESULT" | jq -r .url)
PORT=$(echo "$RESULT" | jq -r .port)
DB=$(echo "$RESULT" | jq -r .dbPath)
```

### Mint a session JWT (for authenticated smoke)

The temp DB is a prod snapshot. Active user is `user_id=2`. Mint a session cookie from the worktree's `JWT_SIGNING_KEY`:

```bash
cd /Users/george-mac-mini/Documents/code/whoop-dashboard-issue-334/apps/web && node -e "
const fs = require('fs');
const envText = fs.readFileSync('.env', 'utf8');
const raw = envText.match(/^JWT_SIGNING_KEY=(.+)$/m)[1].trim();
const { SignJWT } = require('jose');
const key = new Uint8Array(Buffer.from(raw, 'base64'));
(async () => {
  const tok = await new SignJWT({})
    .setProtectedHeader({alg:'HS256'})
    .setSubject('2')
    .setIssuer('coach-api')
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key);
  process.stdout.write(tok);
})();"
```

### If lazy ALTERs haven't run yet on the snapshot DB

The snapshot pre-dates `openWrite()`. If `PRAGMA table_info(user_settings)` is missing E-phase columns, the dev server will ALTER on first write — or you can ALTER manually upfront to mirror prod-post-deploy:

```bash
sqlite3 "$DB" "ALTER TABLE user_settings ADD COLUMN coach_goals TEXT; \
  ALTER TABLE user_settings ADD COLUMN onboarded_at TEXT; \
  ALTER TABLE user_settings ADD COLUMN tz TEXT;"
```

(Historical note: the retired VM lacked `sqlite3`, so its verification used Python.)

### Drive the Settings BYOK section

```bash
JWT="<paste minted token>"
agent-browser open "$URL/signin"
agent-browser cookies set "__Host-coach_session" "$JWT" \
  --url "$URL" --path / --secure --sameSite Lax
agent-browser open "$URL/settings"
agent-browser snapshot -i      # find the new BYOK input + Save + Clear refs
agent-browser fill @eN "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
agent-browser click @eM        # Save
agent-browser snapshot -i      # verify "Using your personal key (sk-ant-…XXXX)"
agent-browser screenshot /tmp/byok-saved.png
# DB check:
sqlite3 "$DB" "SELECT user_id, anthropic_key IS NOT NULL, anthropic_key_version FROM user_settings WHERE user_id = 2"
# Clear:
agent-browser click @eClear
agent-browser snapshot -i      # verify "Using shared server key"
agent-browser close
```

### Tear down

```bash
bash ~/.claude/skills/whoop-dev/bin/down.sh --port $PORT
```

For probe-error and bad-key smoke, you can hit the endpoint directly without the UI:

```bash
curl -sX POST -H "Cookie: __Host-coach_session=$JWT" \
  -H "content-type: application/json" \
  -d '{"key":"sk-ant-invalid-xxxxx"}' \
  "$URL/api/me/anthropic-key" | jq .
# expect {"ok":false,"code":"invalid_key"}
```

## Reference: agent-browser

```bash
agent-browser open <url>
agent-browser snapshot -i              # @e refs for interactive elements
agent-browser click|fill|type @eN [val]
agent-browser screenshot <path>
agent-browser cookies set <name> <val> [--url ... --secure --sameSite Lax]
agent-browser close
# Bootstrap for a fresh agent:
agent-browser skills get core --full
```

Refs go stale on every page change — always re-snapshot before the next ref click.

## Commit shape

Group tightly. Conventional commits. Examples:
- `feat(db): /api/me/anthropic-key GET/POST/DELETE` (or one commit per verb)
- `feat(coach): resolve effective API key per request (BYOK → env → 503)`
- `feat(coach): BadApiKeyError + SSE kind=bad_api_key plumb`
- `feat(insights): BYOK-aware regen lock`
- `feat(settings): BYOK Coach section (paste/validate/save/clear)`
- `test(coach): probe-failure + key-resolution unit tests`

## After review-loop is clean

```bash
git push -u origin feat/334-byok-anthropic-key
gh pr create --title "feat(settings): BYOK Anthropic key (Phase E.2)" --body "..."
# Then poll CodeRabbit + line-level review:
gh api repos/georgenijo/whoop-dashboard/pulls/<n>/comments
gh api repos/georgenijo/whoop-dashboard/pulls/<n>/reviews
# Fix any new findings, commit, push.
```

## What the user expects when reporting

Terse status updates only at meaningful milestones (plan landed, pass N reviewer found X, ready to open PR, PR opened). No filler. The user is in caveman mode — fragments OK, articles OK to drop. Code, commits, PR bodies stay normal English.

## One-line kickoff for the fresh session

```
Read docs/agent-context/E2-handoff.md and start the pipeline for issue #334.
```
