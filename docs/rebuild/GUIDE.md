# Rebuild Implementation Guide

Living playbook. Any agent executing this rebuild reads this to pick up the thread. See [`PLAN.md`](./PLAN.md) for the full architectural rationale (locked — don't relitigate).

---

## Status snapshot

**Current phase:** 1 (monorepo reorg + Next.js scaffold)
**Last updated:** 2026-04-23
**Open blockers:** Spike B (CLI-in-container) is deferred — won't block Phase 1 code work, but gates #57 (Containerfile).

| Phase | Status | Notes |
|---|---|---|
| 0 — Spikes + issue backlog | **Done (except Spike B)** | Spike A verdict: Recharts acceptable w/ tuning. Spike B deferred — run on OptiPlex when convenient. |
| 1 — Monorepo reorg, SQLite migration, Next.js scaffold, overview | **Active** | Start with #54 (reorg) — unblocks #55, #56, #57. |
| 2 — AI Insight + Chat, Sleep Deep Dive | Not started | Depends on #56 (scaffold) and Spike B verdict for chat path |
| 3 — Specialty signals (8–10 cards) | Not started | Each needs component-vocabulary extension (kit doesn't design these) |
| 4 — Responsive + cutover | Not started | |

---

## Machine matrix

Where each kind of work can run. Respect this — several agents have wasted cycles trying to run OptiPlex-only work from a sandboxed environment.

| Task | Local Mac | OptiPlex | Claude Code Web |
|---|:---:|:---:|:---:|
| Edit code (Next.js, TS, Python) | ✓ | ✓ | ✓ |
| `pnpm install` / `pnpm build` / type check | ✓ | ✓ | ✓ |
| Open GitHub issues / PRs | ✓ | ✓ | ✓ |
| Spike B (Claude CLI in Podman) | ✗ (no Podman-native) | ✓ | ✗ |
| Build/run Containerfile | via remote Podman | ✓ | ✗ |
| Quadlet unit install + test | ✗ | ✓ | ✗ |
| Systemctl operations (start pod, tunnel) | ✗ | ✓ | ✗ |
| Test with real Whoop OAuth + data | ✗ (no DB) | ✓ | ✗ |
| Test overview screen with fixtures | ✓ | ✓ | ✓ |

**Cloud agent rule:** if a task depends on a `✓` in the OptiPlex column and nowhere else, stop and note it as user-manual work on the relevant issue. Do not simulate or mock the OptiPlex.

---

## Phase 0 — Complete (reference)

Two spikes + 8 tracked issues.

- **Issues filed:** #51–#58. See `gh issue list --label rebuild --state all`.
- **Spike A** (#52) — **Passed** with tuning. See [`SPIKE_A_REPORT.md`](./SPIKE_A_REPORT.md). Key findings:
  - Recharts `type="monotone"` matches the kit's Catmull-Rom closely enough for the 12 time-series charts
  - Apply `strokeWidth={1.0}` or `{1.25}` (kit is `1.5` but Recharts doesn't support `vectorEffect="non-scaling-stroke"`)
  - Custom `<GlowEndDot>` component needed for end-dot drop-shadow filter (Recharts' `activeDot` prop doesn't pass SVG filters through)
  - Wrap every Recharts chart in `<ChartFrame mountOnClient>` to dodge SSR -1-dimension warning
  - Strip nested `@import url(...)` from kit CSS when copying into `apps/web/`; hoist Google Fonts import to top of `globals.css`
  - `create-next-app@latest` resolves to **Next.js 16.2.4** (not 15). Decision: accept 16.x per user direction.
- **Spike B** (#53) — **Deferred**. Failed to reach OptiPlex from the handoff session (port 22 vs tailscale SSH path confusion). Runbook posted on the issue. Action: user runs manually on OptiPlex when convenient, OR a future local session retries via `/Applications/Tailscale.app/Contents/MacOS/Tailscale ssh george@optiplex`. Blocks #57 only.

---

## Phase 1 — Detailed (active)

Four issues, ordered by dependency. Each should be a separate branch + PR.

### #54 — Monorepo reorg (start here)

**Goal:** split the repo into `streamlit/`, `apps/web/`, `sync/`, `shared/` without breaking the live Streamlit app on the OptiPlex.

**Moves:**
- `app.py` → `streamlit/app.py`
- `whoop/` → `streamlit/whoop/` **and** `sync/whoop/` (duplicate during migration; `sync/` becomes the canonical copy in Phase 4)
- daily sync entry point → `sync/daily_sync.py`
- `requirements.txt` → `streamlit/requirements.txt` and `sync/requirements.txt` (may have different deps by Phase 4)
- `.streamlit/` → `streamlit/.streamlit/`
- `systemd/` → `ops/systemd/` (legacy units live here; Quadlet units land in `ops/quadlet/` later)
- `tokens.json` → **stays at repo root** for now; moves in #55
- `shared/whoop_data.db` → **stays under `shared/`**

**Creates:**
- `apps/web/` (empty, for #56)
- `shared/` (contains `whoop_data.db`)
- `ops/quadlet/` (empty, for #57)

**Preserve on OptiPlex:** the live Streamlit `systemd/whoop-dashboard.service` unit references the old path. Update the unit's `WorkingDirectory` to the new `streamlit/` subfolder in a separate follow-up; **do not restart the service in this PR**.

**Verification:** `python3 -m py_compile streamlit/app.py streamlit/whoop/*.py sync/daily_sync.py` passes. `cd apps/web && npm run build` succeeds.

### #55 — SQLite migration

**Goal:** extend the shared DB with `signals` and `tokens` tables, with WAL mode verified under concurrent readers/writers.

- Keep `shared/whoop_data.db` in place
- Update `streamlit/whoop/db.py` path handling if schema changes require it
- Keep `streamlit/app.py` working
- Add schema migrations:
  - `signals` table: `date TEXT, signal_name TEXT, value REAL, metadata JSON, computed_at TEXT` — written by `sync/`, read by Next.js
  - `tokens` table: `user_id TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT, expires_at INTEGER` — replaces `tokens.json`
- Migration script `sync/migrations/001_add_signals_tokens.py` — idempotent, run once
- Verify `PRAGMA journal_mode=WAL` already set (it is per existing code)
- Concurrent write test: run sync + a read simulating Next.js for 60s, confirm no `database is locked` errors

**Verification:** Streamlit still loads from new path. Ad-hoc SQL: `.schema signals tokens` shows the tables. `tokens.json` still exists for backward compat but is now the source of truth is the DB.

### #56 — Next.js scaffold

**Goal:** wire Next.js 16 + Geist + kit CSS into `apps/web/`. No business logic yet — just the foundation.

**Setup inside `apps/web/`:**
```bash
pnpm create next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --turbopack --no-git
pnpm add recharts better-sqlite3
pnpm add -D @types/better-sqlite3
```

**Files to add (key ones):**
- `apps/web/src/app/colors_and_type.css` — copy from `~/Downloads/Whoop_ Design System/colors_and_type.css` **with nested `@import` stripped**
- `apps/web/src/app/kit.css` — copy from `~/Downloads/Whoop_ Design System/ui_kits/dashboard/styles.css` **with nested `@import` stripped**
- `apps/web/src/app/globals.css` — imports Geist fonts from Google Fonts (hoisted to top), then `colors_and_type.css`, then `kit.css`, then `@import "tailwindcss";`
- `apps/web/src/components/ChartFrame.tsx` — mount-gate wrapper for all Recharts charts (from Spike A learnings)
- `apps/web/src/components/GlowEndDot.tsx` — custom dot component for chart end-points with drop-shadow filter
- `apps/web/src/lib/chart-theme.ts` — exports `STROKE_WIDTH = 1.0`, metric colors, gradient stop helpers

**Cloud-agent note:** if you don't have access to `~/Downloads/`, the spike repo at `~/Documents/code/scratch-whoop-spike-a/src/app/` has the stripped CSS files ready to copy. If you don't have access to that either, fetch the CSS verbatim from the design system — the maintainer will paste it into a subsequent message.

**Verification:** `pnpm --filter web dev` serves on `:3000` showing an empty page with aurora background + Geist body font + strain-red accent loaded. `pnpm --filter web build` succeeds without warnings.

### #57 — Containerfile + Quadlet (gated on Spike B)

**Only start this once Spike B has a verdict.** If bind-mount works, use it. If not, install CLI in the image and mount only `~/.claude/` for auth.

**Creates:**
- `apps/web/Containerfile` — multi-stage, Debian-slim, Node 22, Next.js standalone output
- `ops/quadlet/whoop-web.pod` — pod definition (port 3000 published)
- `ops/quadlet/whoop-web.container` — Next.js container attached to pod, with bind mounts:
  - `shared/whoop_data.db` → `/data/whoop_data.db`
  - host claude binary (path resolved at install time) → `/usr/local/bin/claude:ro`
  - `/home/george/.claude` → `/root/.claude:ro`
- `ops/quadlet/install.sh` — one-shot to copy Quadlet units into `/etc/containers/systemd/` and `systemctl daemon-reload`

**Verification (OptiPlex only):**
- `podman build -t whoop-web ./apps/web` succeeds
- `podman run --rm whoop-web node -e "console.log('ok')"` prints ok
- `sudo cp ops/quadlet/*.{pod,container} /etc/containers/systemd/ && sudo systemctl daemon-reload && sudo systemctl start whoop-web.pod` succeeds
- `curl http://localhost:3000` returns the Next.js default page
- `podman exec whoop-web-container claude --version` returns a version string (confirms bind mount)

---

## Phase 2 — High level

- **AI Insight card** — port `whoop/insights.py` logic to `apps/web/src/lib/claude-spawn.ts` (Node `child_process.spawn('claude', ...)`). Context builder: same SQL queries + string formatting as Python version.
- **Chat surface** — port `whoop/chat.py` similarly. Stream responses via Server-Sent Events or Next.js streaming responses.
- **Sleep Deep Dive tab** — structure only in this phase; individual specialty cards land in Phase 3.

**Cloud-agent note:** You can port the code but can't test the `claude` spawn path (no binary in sandbox). Stub with a mock that returns canned responses. User or local session tests end-to-end.

---

## Phase 3 — High level

Port 8–10 specialty signals. Each is an independent card:

- Illness early warning (14d rolling baselines)
- Overtraining Score (OTS)
- ANS index
- Recovery rebound rate
- Strain-recovery balance
- Cardiac drift detection
- Sleep apnea risk signal
- Respiratory rate anomaly
- Nap tracker
- Bedtime & wake time patterns

**Kit doesn't design these.** Extend the component vocabulary: glass card + title + metric-colored dot + `<ChartFrame>` body. Each signal gets a design decision (layout, primary metric, viz type) — budget ~0.5d per signal. See Plan §"Specialty signal design gap" for the extension pattern.

This is the best candidate for agent teams if you want to try them (see `PLAN.md` references).

---

## Phase 4 — High level

- Responsive pass (kit is desktop-only — add breakpoints for 768/1024)
- Empty/error/loading states across all cards
- Cutover: update Streamlit systemd to stopped+disabled, then retire `streamlit/`
- Rewrite `CLAUDE.md` to reflect Next.js architecture
- Remove `tokens.json` (now in DB)

---

## Ground rules (every phase)

- **Don't relitigate locked decisions.** See `PLAN.md` §"Locked Decisions". If you want to change one, open an ADR first.
- **Preserve the live Streamlit app on OptiPlex** until Phase 4. Don't restart services, don't move files it depends on without updating its systemd unit.
- **Don't touch Oura-tagged work** (issues #41–#49). Python-side Oura continues in parallel and lives under `sync/` alongside whoop.
- **No `--dangerously-skip-permissions`, `--no-verify`, or destructive escapes** without explicit user approval.
- **Scratch-spike code** at `~/Documents/code/scratch-whoop-spike-a/` is throwaway. Copy learnings into `apps/web/`; do not import the scratch repo as a dep.
- **Branch per issue, PR to main.** The main branch stays deployable (once Phase 1 is done, `main` should build both Streamlit and Next.js).

---

## References

- **Plan:** [`PLAN.md`](./PLAN.md) — the why and what
- **Spike A report:** [`SPIKE_A_REPORT.md`](./SPIKE_A_REPORT.md) — Recharts tuning decisions
- **Design system (local only):** `~/Downloads/Whoop_ Design System/` — colors, type, kit components (cloud agents: see #56 note for fallback)
- **Current code:** `streamlit/app.py`, `streamlit/whoop/*`, `sync/daily_sync.py`, and `apps/web/`
- **CLAUDE.md** — describes the current Streamlit system; rewritten at Phase 4
