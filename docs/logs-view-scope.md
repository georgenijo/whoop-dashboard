# Logs View — Scope & Goal

Status: scoping (2026-05-16). Owner: George. Burn-pipeline target.

## Goal (one sentence)

A single `/logs` page on the VM that shows **every event the system or user has produced** — backend errors, sync runs, coach turns, route hits, webhook deliveries, web pageviews/clicks, web JS errors, iOS lifecycle events, iOS errors — unified into one filterable, searchable, expandable timeline with the same UX polish as Murmur's log viewer.

## Success criteria (definition of done)

The page is "done" when **all** of these are true:

1. **Unified timeline tab** — one scrollable list combining server events, client events, sync runs, coach turns, route hits, webhook deliveries. Newest first by default.
2. **Source chips** — color-coded badges for each source (server, web, ios, sync, coach, webhook, route). Toggleable to filter.
3. **Level filter** — info / warn / error toggles. Default: warn+. Toggle on info for full firehose.
4. **Search box** — substring search across message + JSON payload (`LIKE %q%`).
5. **Time range** — last 1h / 24h / 7d / all. Default: 24h.
6. **Row expand** — click a row to see structured JSON payload pretty-printed inline.
7. **Live tail toggle** — when on, page refreshes every 3s (SWR interval). When off, static snapshot.
8. **KPI strip** — keep the existing requests/avg-duration/p50/p95/error-rate row at the top.
9. **Coach block inspector** — clicking a `coach` row expands to render the full `chat_messages.blocks` chain (user → thinking → tool_use → tool_result → assistant text) in human-readable form. Subsumes issue #286 (coach CLI).
10. **Server logger** — `pino` wired via `apps/web/src/lib/logger.ts`. ~10 highest-value `console.*` calls migrated (auth, chat, sync, webhook handler).
11. **Server-side warn+ events** persisted to `server_logs` table — surfaced in the unified timeline.
12. **Web client capture** — `window.onerror`, `unhandledrejection`, React ErrorBoundary, pageview tracker, and `data-track` clicks on 6 key elements (nav links, sync button, coach send, sign out, settings save, Whoop connect) all POST to `/api/log/client` → `client_logs` table.
13. **iOS client capture** — `ClientLogger` Swift module pipes uncaught errors + APIClient errors + lifecycle events (sign in/out, foreground/background, push received, deep link opened) to `/api/log/client` with `source=ios`. No SwiftUI click-capture in v1.
14. **All-green smoke** — `whoop-dev` snapshot → verify Murmur-style row rendering, expand behavior, live tail, filters, coach block inspector. `npm run build` clean. CI vitest green (`scoped.test.ts` still passes).
15. **Deployed** — merged to `main`, pulled to VM, `whoop-web.service` restarted, `https://coach.georgenijo.com/logs` shows events end-to-end.

## Lanes (burn-pipeline order)

Five lanes, dependency-ordered. L2+L3 parallel after L1. L5 last.

### Lane 1 — Schema + logger foundation (blocks all others)
- Add `server_logs` + `client_logs` lazy-bootstrapped tables in `connection.ts`.
- New `apps/web/src/lib/logger.ts` exposing pino root + `forModule(name)` child factory. JSON in prod, pretty in dev.
- New `apps/web/src/lib/db/server-logs.ts` and `client-logs.ts` for `insert*` + `recent*` helpers.
- New endpoint `POST /api/log/client` — auth-gated (cookie/bearer), schema-validated, INSERT into `client_logs`.
- Migrate ~10 highest-value `console.*` to `logger.error/warn/info` with structured fields. Warn+ also flows into `server_logs` via a pino transport hook (or a thin wrapper that double-writes — simpler).
- Files touched: `apps/web/src/lib/db/connection.ts`, `apps/web/src/lib/logger.ts` (new), `apps/web/src/lib/db/server-logs.ts` (new), `apps/web/src/lib/db/client-logs.ts` (new), `apps/web/src/app/api/log/client/route.ts` (new), ~10 console-migration files.

### Lane 2 — Web client capture (parallel after L1)
- `apps/web/src/lib/clog.ts` — fire-and-forget POST to `/api/log/client`. Batches `setTimeout(0)`, ignores failures.
- Global error listeners installed in a client-side bootstrap component (`apps/web/src/components/ClientLogBootstrap.tsx`) mounted from `(dashboard)/layout.tsx`.
- React `ErrorBoundary` wrapping the dashboard layout children.
- Pageview tracker — usePathname effect → `clog.event('pageview', { path })`.
- `data-track` attributes on the 6 listed elements + a global delegated click handler that picks them up.
- Files touched: `apps/web/src/lib/clog.ts` (new), `apps/web/src/components/ClientLogBootstrap.tsx` (new), `apps/web/src/components/ErrorBoundary.tsx` (new), `apps/web/src/app/(dashboard)/layout.tsx`, ~6 component edits for `data-track` attrs.

### Lane 3 — iOS client capture (parallel after L1)
- New `apps/ios/Coach/Services/ClientLogger.swift`.
- Pipe through `APIClient` error path — every non-2xx + every thrown error becomes a log event.
- Lifecycle hooks in `CoachApp.swift` for signIn/signOut/scenePhase/pushReceived/deepLink.
- `NSSetUncaughtExceptionHandler` for global crashes.
- POSTs to `https://coach-api.georgenijo.com/api/log/client` with `source=ios`, Bearer auth.
- Files touched: `apps/ios/Coach/Services/ClientLogger.swift` (new), `apps/ios/Coach/Services/APIClient.swift`, `apps/ios/Coach/CoachApp.swift`.

### Lane 4 — Unified logs UI (after L1; benefits from L2+L3 data)
- Rewrite `/logs/page.tsx` around a unified `events` query that UNIONs `server_logs`, `client_logs`, `sync_logs`, `chat_logs`, `route_logs`, `webhook_events` into one timeline.
- New `apps/web/src/lib/db/events.ts` with `getUnifiedEvents({ sources, levels, q, since })` and a row shape `{ ts, source, level, summary, payload }`.
- New `EventTimeline.tsx`, `SourceChips.tsx`, `LevelFilter.tsx`, `TimeRangeSelect.tsx`, `SearchBox.tsx`, `EventRow.tsx`, `LiveTailToggle.tsx`. Tailwind, color-coded by source.
- SWR polling at 3s when live tail on; pause on tab-hidden.
- Files touched: `apps/web/src/app/(dashboard)/logs/page.tsx`, `apps/web/src/lib/db/events.ts` (new), seven new components in `apps/web/src/app/(dashboard)/logs/`.

### Lane 5 — Coach block inspector (after L4)
- Inside `EventRow` expand for `source=coach`, render `chat_messages.blocks` chain.
- New `apps/web/src/lib/db/coach-blocks.ts` `getThreadBlocks(threadId)`.
- New `CoachBlockChain.tsx` component — vertical stack of `BlockCard` per block, color by role (user/thinking/tool_use/tool_result/assistant).
- Subsumes issue #286.
- Files touched: `EventRow.tsx`, `CoachBlockChain.tsx` (new), `BlockCard.tsx` (new), `apps/web/src/lib/db/coach-blocks.ts` (new).

## Decisions taken on user's behalf

User said "if you have any questions, choose your best option, but note it." Logged here.

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | New lib for backend logger? | **pino + pino-pretty** | Issue #305 already names it. Fastest. Smallest. JSON-native. |
| 2 | Storage for server events? | **`server_logs` table (warn+)** + journald for all levels | Ring buffer dies on Next.js process restart. Files split readability. SQL query in same place as everything else. Warn+ only to keep volume sane. |
| 3 | Web click tracking — auto or explicit? | **Explicit `data-track` on 6 elements** | Auto-capture is noisy, PII-risky, and personal-use scale doesn't need it. |
| 4 | iOS click tracking? | **Defer (errors + lifecycle only)** | SwiftUI click hooks are heavy. Errors + lifecycle covers 90% of debug value. |
| 5 | Live tail mechanism? | **SWR 3s polling, paused when tab hidden** | SSE/WS is over-engineered for personal-use. 3s feels live enough. |
| 6 | Search backend — FTS or LIKE? | **LIKE** | Volume tiny (<1M rows). FTS5 setup overhead not worth it. |
| 7 | Coach CLI (issue #286)? | **Subsume into Lane 5 (block inspector in UI)** | Earlier convo concluded UI extension beats CLI. SIWA-gated, no SSH. |
| 8 | Retention / cleanup? | **Out of scope for v1** | Add a `purge_old_logs` job later if `client_logs` blows up. SQLite handles millions of rows fine. |
| 9 | Sampling? | **None for v1** | All warn+ kept. Info from client gated by level toggle in UI. |
| 10 | iOS endpoint host? | **`coach-api.georgenijo.com`** | iOS already uses it; web uses `coach.georgenijo.com`. Same backend, no CF Access on api host. |
| 11 | data-track click events stored where? | **`client_logs` w/ `kind=click`** | One table, one ingestion path. Use the `level=info` channel. |
| 12 | Auth on `/api/log/client`? | **Required (Bearer/cookie)** | Anonymous would invite abuse. Authenticated users only. |

## Out of scope

- Sentry / external reporting (issue #305 Tier 4) — defer.
- Metrics tab à la Murmur (timing charts of coach turns) — separate follow-up.
- Log purge / retention job — defer.
- iOS click-capture — defer.
- Cross-user log isolation in UI — backend stamps `user_id` on every event but v1 UI is single-user (admin sees own logs).
- Anonymous error capture from `/signin` page — auth-required endpoint means signed-out errors won't pipe. Acceptable for v1.

## Verification before "done"

Before claiming done, agent must:
- Spin up `whoop-dev` against worktree.
- `agent-browser` open `/logs`, snapshot, screenshot.
- Trigger a synthetic event from each source (sync run, coach turn, pageview, click, intentional JS error, intentional iOS error).
- Confirm each appears in the timeline with correct chip color + expandable payload.
- `npm run build` clean. Vitest green.
- VM smoke after deploy: `curl localhost:8501/logs` returns 200 (or 302 if SIWA — fine).

## References

- Murmur log viewer: `/Users/george-mac-mini/Documents/code/murmur-app/app/src/components/log-viewer/`
- Existing /logs page: `apps/web/src/app/(dashboard)/logs/page.tsx`
- Schema home: `apps/web/src/lib/db/connection.ts`
- Existing logger ask: issue #305 (Tier 1-3 covered here; Tier 4 deferred)
- Coach CLI subsumed: issue #286 (will close as superseded once Lane 5 ships)
