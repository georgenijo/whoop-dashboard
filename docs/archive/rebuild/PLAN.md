# Whoop Dashboard Rebuild — Next.js + Whoop+ Design System

## Context

The Whoop dashboard is currently a single-user Streamlit + Plotly app (`streamlit/app.py`, ~1,900 lines, 14 specialty signal sections) running on a Linux host (Dell OptiPlex, Ubuntu 24.04) with a daily Whoop sync cron, OAuth2 auth, and SQLite history. Chat and daily insights shell out to the `claude` CLI.

The user downloaded a generated "Whoop+ Design System" to `~/Downloads/Whoop_ Design System/` — a dark-first, data-dense aesthetic with aurora backgrounds, glass cards, smoothed bezier charts, Geist typography, violet-glow AI surfaces, and a desktop-only overview layout. The kit ships as plain React + JSX (Babel standalone) explicitly intended to be ported into a production framework, not reproduced inside Streamlit.

Assessment concluded Streamlit cannot faithfully render this design system (framework-level mismatch on aurora, glass cards, smoothed curves, sidebar chrome, AI glow). The user committed to a full rebuild ("Path A"). This plan captures the resulting architecture, phasing, and Phase 0 deliverables.

**Intended outcome:** Replace `streamlit/app.py` with a Next.js 16 web app running as a Podman pod on the same OptiPlex, preserving all current features (Overview, Sleep Deep Dive, Chat, 14 specialty signals), wired to the existing SQLite DB via a cleaner read/write split.

## Locked Decisions

1. **Frontend: Next.js 16 (App Router)** — mature, batteries-included, self-hostable. Considered and rejected: TanStack Start (pre-1.0), Vite + React SPA (no API routes = more moving parts).
2. **Backend: batch split** — Python stays as the data pipeline (daily sync cron + signal computation → writes to SQLite). Next.js is a read-only consumer of SQLite + OAuth entry point + `claude` CLI proxy for chat/insights. No FastAPI, no HTTP hop between TS and Python. Rejected: full TS rewrite (pandas→TS is painful for ~10 signal calcs), FastAPI layer (unnecessary given batch split).
3. **Charts: Recharts + inline SVG hybrid** — Recharts for the ~12 standard time-series charts (supports smoothed curves via `type="monotone"`, gradient fills via `<linearGradient>`). Inline SVG for the recovery ring and sleep HR ribbon (not charts). Rejected: Plotly React (fights the DS aesthetic), Visx (too low-level for ROI), full inline SVG (no interactivity at 15 charts).
4. **Repo layout: monorepo, subfolders** — `streamlit/` (legacy, runs during migration), `apps/web/` (new Next.js), `sync/` (daily Python job), `shared/` (SQLite + fixtures). Both services hit the same `shared/whoop_data.db` during cutover. Rejected: new repo (loses memory, issue tracker, dotfiles paths).
5. **Oura track (#41–#49): continue Python-side work, pause UI-only issues** — provider abstraction, schema migration, Oura auth/sync/deploy all live in the Python pipeline, which survives the rebuild unchanged. Only Streamlit-specific Oura UI is paused.
6. **Deploy: Podman pod + Quadlet** — rootful Podman 4.9.3 is already on the OptiPlex. New `whoop-web.pod` + `whoop-web.container` Quadlet units in `/etc/containers/systemd/`. Cloudflared tunnel (`whoop-tunnel.service` already running) gets a new ingress route to port 3000. Daily Python sync stays as-is (host-level, not containerized).

## Architecture After Rebuild

```
OptiPlex (Ubuntu 24.04, rootful Podman)
├── whoop-sync (Python cron/timer, host-level)
│     └── pulls Whoop API → computes signals → writes SQLite
│
├── whoop-web.pod (new, Podman Quadlet, port 3000)
│     └── Next.js 16 container
│           ├── reads SQLite (better-sqlite3)
│           ├── handles OAuth callback
│           └── spawns host `claude` via bind-mounted /usr/bin/claude + ~/.claude/
│
└── whoop-tunnel.service (existing Cloudflare tunnel)
      └── adds route: whoop.<domain> → localhost:3000
```

## Phasing Overview

| Phase | Scope | Est effort |
|---|---|---|
| 0 | Two spikes (framework + CLI-in-container) to de-risk before committing code | 2–3d |
| 1 | Monorepo reorg, SQLite migration, Next.js scaffold, overview screen wired to real data, Containerfile + Quadlet unit | 1.5–2w |
| 2 | AI Insight + Chat surfaces (Node spawns `claude`), Sleep Deep Dive structure | 1–1.5w |
| 3 | Port 8–10 specialty signals (illness, OTS, ANS, rebound, strain-recovery, cardiac drift, apnea, nap, bedtime patterns); kit doesn't design these so each needs component-vocabulary extension | 1.5–2w |
| 4 | Responsive pass, empty/error/loading states, cutover, retire Streamlit, update CLAUDE.md | 3–5d |

**Total: ~5–7 weeks of focused solo work. Expect 7–10 calendar weeks.**

## Phase 0 — Two Spikes (this plan's execution target)

### Spike A: Framework + chart rendering

Scratch repo. Next.js 16 + Recharts + Geist + `colors_and_type.css` imported verbatim. Build one component from each category:
- **Recovery ring** (inline SVG — copy Catmull-Rom helper from `ui_kits/dashboard/Metrics.jsx`)
- **KPI card** with micro-sparkline (match kit exactly)
- **Recovery trend chart** (Recharts with smoothed curve + gradient area fill — confirm the visual is indistinguishable from the inline-SVG version in the kit)
- **AI insight card** with violet glow + pulsing dot

**Success criterion:** side-by-side with `ui_kits/dashboard/index.html` the scratch version is visually indistinguishable at normal viewing distance. If Recharts can't match the smoothed bezier look closely enough, downgrade to inline SVG or Visx and document why.

### Spike B: Claude CLI inside a Podman container

Minimal Containerfile (Debian-slim, Node 22, Next.js standalone). Two approaches to test in order:

1. **Bind-mount host CLI** (preferred, cheapest, de-risked by recon): mount `/usr/bin/claude` + `/home/george/.claude/` into container. From inside the container, confirm `claude --version` and a trivial `claude "say hi"` round-trip work.
2. **Install CLI in container** (fallback): `RUN npm install -g @anthropic-ai/claude-code` in the image, mount only `~/.claude/` for auth.

**Success criterion:** inside the container, a `child_process.spawn('claude', [...])` round-trip succeeds with auth inherited from the host. If neither works, escalate to "Node uses `@anthropic-ai/sdk` + API key" — flag as architectural change requiring user decision.

## Phase 0 — Issue Backlog to File

All 8 issues target the `georgenijo/whoop-dashboard` repo. Create a new `rebuild` label alongside existing `enhancement`.

1. **`epic: Next.js rebuild (Whoop+ design system)`** — master tracking issue with task-list referencing #2–#8.
2. **`rebuild(phase-0): architecture decision record`** — body captures the 6 locked decisions + rationale verbatim from this plan.
3. **`rebuild(phase-0): spike — Next.js 16 + Recharts + recovery ring`** — Spike A above.
4. **`rebuild(phase-0): spike — Claude CLI inside Podman container`** — Spike B above.
5. **`rebuild(phase-1): monorepo reorg — streamlit/, apps/web/, sync/, and shared/ layout`**
6. **`rebuild(phase-1): SQLite migration — extend shared/whoop_data.db with signals + tokens tables, WAL verified`**
7. **`rebuild(phase-1): Next.js scaffold + Geist fonts + import colors_and_type.css`**
8. **`rebuild(phase-1): Containerfile + whoop-web.pod Quadlet unit (rootful, bind-mount /usr/bin/claude + ~/.claude/)`**

## Critical Files

### To be touched in rebuild

- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/app.py` — 1,900-line Streamlit entry, eventually retired
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/client.py` — Whoop REST client + OAuth refresh; port to TypeScript in Phase 1
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/auth.py` — OAuth2 flow; port to Next.js route handlers in Phase 1
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/db.py` — SQLite wrapper; schema extended in Phase 1 (add `signals` and `tokens` tables)
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/insights.py` — Context builder + `claude` CLI spawn; logic ported to Node in Phase 2
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/chat.py` — Same pattern as insights.py; Phase 2
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/streamlit/whoop/ots.py` — numpy/pandas signal math; **stays Python** under new batch split
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/CLAUDE.md` — rewritten at Phase 4 cutover
- `/Users/george-mac-mini/Documents/code/whoop-dashboard/requirements.txt` — pared down to sync-only deps in Phase 4

### New files created (Phase 1+)

- `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/src/app/**/*` — Next.js 16 App Router scaffold
- `apps/web/src/lib/db.ts` — better-sqlite3 wrapper, typed query helpers
- `apps/web/src/lib/whoop-client.ts` — TS port of `whoop/client.py`
- `apps/web/src/lib/claude-spawn.ts` — `child_process.spawn` wrapper for chat/insights
- `apps/web/src/app/api/auth/callback/route.ts` — OAuth callback handler (replaces Streamlit session-state flow)
- `apps/web/Containerfile` — multi-stage Debian-slim → Node 22 → Next.js standalone
- `/etc/containers/systemd/whoop-web.pod` — Quadlet pod definition
- `/etc/containers/systemd/whoop-web.container` — Quadlet container definition (bind mounts for SQLite, `/usr/bin/claude`, `/home/george/.claude/`)
- `shared/whoop_data.db` — shared SQLite file used by sync and web

### Reference — design system (read-only, do not modify)

- `/Users/george-mac-mini/Downloads/Whoop_ Design System/colors_and_type.css` — imported verbatim
- `/Users/george-mac-mini/Downloads/Whoop_ Design System/ui_kits/dashboard/Metrics.jsx` — Catmull-Rom helper lifted for recovery ring
- `/Users/george-mac-mini/Downloads/Whoop_ Design System/ui_kits/dashboard/Chrome.jsx` — sidebar + topbar reference
- `/Users/george-mac-mini/Downloads/Whoop_ Design System/ui_kits/dashboard/Coach.jsx` — AI insight + composer reference
- `/Users/george-mac-mini/Downloads/Whoop_ Design System/ui_kits/dashboard/styles.css` — layout + aurora + card + AI styles

## Verification

### Phase 0 success
- Spike A scratch repo renders 4 components pixel-matched to `ui_kits/dashboard/index.html`; screenshot comparison documented in the spike issue.
- Spike B container successfully round-trips a `claude "echo test"` invocation with host-bound credentials; `docker exec -it whoop-web claude --version` returns v2.1.105.
- All 8 issues filed, `rebuild` label created, epic has cross-references to all sub-issues.

### Phase 1 success (overview screen)
- Dashboard at `https://whoop.<domain>` shows real current recovery/HRV/RHR/strain/sleep/SpO2 from live Whoop data via OAuth.
- Visual match to kit: aurora renders, glass cards render, recovery ring shows correct score, KPI cards show correct deltas, Recharts trends use smoothed curves with gradient fills.
- `systemctl status whoop-web.pod` is active; Cloudflare tunnel route resolves.
- Streamlit still running on port 8501 for regression comparison.

### Full rebuild success (Phase 4 cutover)
- All 14 specialty signal sections from `streamlit/app.py` present in the Next.js app.
- Streamlit systemd unit stopped and disabled; `streamlit/` retired; `requirements.txt` pared to sync-only deps.
- `CLAUDE.md` rewritten to reflect Next.js architecture.
- Single daily sync cron still writes to SQLite; Next.js reads fresh data the next morning.

## Risks & Open Questions

- **Recharts vs kit fidelity** — if Recharts' `type="monotone"` curves don't visually match the kit's Catmull-Rom splines closely enough, Phase 0 Spike A forces a choice between Visx and inline SVG. Visx adds ~10–20% per-chart effort for 15 charts.
- **Rootful Podman + SQLite concurrent writers** — Python cron on host writes, Next.js container reads (and writes tokens). WAL mode handles this but needs a ~1h validation test in Phase 1.
- **Claude CLI subscription/TOS for automated container use** — verified installed on host, bind-mount path likely works; Spike B confirms. Escape hatch: swap to `@anthropic-ai/sdk` (pay-per-token, against stated preference per memory).
- **Specialty signal design gap** — the Whoop+ DS only provides 6 component patterns. 8–10 specialty signals (illness warning, ANS, rebound, etc.) need design decisions in Phase 3 that extend the kit's vocabulary; budget half a day per signal for design.
- **Daily sync timer** — recon didn't surface a timer unit for `sync/daily_sync.py`. Before Phase 1, need to confirm whether it runs via cron, systemd timer, or manual invocation. Plan assumes a systemd timer exists or will be created.
