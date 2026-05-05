# Plan: Issue #172 — Atelier Zero: logs page

**Issues covered:** #172
**Primary file:** `apps/web/src/app/logs/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-172`
**Branch:** `issue/172-atelier-logs`
**Depends on:** #165

## Context

Port `mockup-logs.html` → React behind the Atelier flag. Classic page has 4 KPI cards + 3 collapsible card sections (chat / sync / route logs). Atelier has 3 stat cards (Total, Last sync, Avg duration) + a single chronological event ledger with sport-style filter pills. Headline: *"Three numbers, quietly watched."*

## Files touched
- `apps/web/src/app/logs/page.tsx` — wrap existing JSX in `<div className="classic-logs">`, append `<div className="atelier-logs">` rendering new components.
- `apps/web/src/components/logs/atelier/StatsRow.tsx` *(new)* — 3 stats with sparklines (Total syncs, Last sync, Avg duration).
- `apps/web/src/components/logs/atelier/EventLedger.tsx` *(new, `"use client"`)* — chronological merged ledger with filter pills.
- `apps/web/src/app/theme.css` — append `.atelier-logs *` selectors.

## Architectural decisions

- **Decision: Atelier merges chat / sync / route logs into a single chronological ledger** with filter pills (`All / Sync / Recovery / Sleep / Error`). Mockup mockup-logs.html shows one unified table rather than three separate sections.
- **Decision: keep three feeds queried server-side via existing exports**, then merge to a single sorted array passed to `EventLedger`. Filter is client-side state.
- **Decision: row classification rules:**
  - `route_logs` rows where `route` matches `/recovery` → kind = `Recovery`
  - `route_logs` rows where `route` matches `/sleep` → kind = `Sleep`
  - `route_logs` rows where status >= 500 → kind = `Error`
  - all other `route_logs` → kind = `Page`
  - `sync_logs` → kind = `Sync` (or `Error` if status === "error")
  - `chat_logs` → kind = `Chat` (or `Error` if status === "error")
- **Decision: 3 stats use a hybrid of all 3 sources:**
  - "Total syncs" → `syncLogs.length` (sync events only — matches mockup wording)
  - "Last sync" → time since most recent sync log
  - "Avg duration" → mean duration of `chat_logs` (kept from classic — that's the meaningful latency metric)
- **Decision: sparklines on stat cards.** Total syncs sparkline = sync count per day over last 14 days. Last sync sparkline = horizontal mono dashed line w/ marker (decorative). Avg duration sparkline = bar histogram of last 15 chat-log durations.
- **Decision: ledger limit = 200 rows** (top 200 across all sources after merge) — enough for one screen of scrolling.

## Implementation steps

1. **`logs/page.tsx`** — keep existing data loads (`getChatLogs`, `getSyncLogs`, `getRouteLogs`). Add server-side merge:
   ```ts
   type LedgerRow = {
     ts: string;            // ISO
     kind: "Sync" | "Recovery" | "Sleep" | "Page" | "Chat" | "Error";
     summary: string;       // route or prompt preview
     duration_ms: number | null;
     status: string;
     details?: string | null;
   };
   const ledger: LedgerRow[] = [
     ...syncLogs.map(s => ({ ts: s.started_at, kind: s.status === "error" ? "Error" : "Sync", summary: `Sync · ${s.recovery_count ?? 0}r/${s.sleep_count ?? 0}s/${s.workouts_count ?? 0}w`, duration_ms: s.duration_ms, status: s.status })),
     ...routeLogs.map(r => ({ ts: r.started_at, kind: classifyRoute(r), summary: r.route, duration_ms: r.duration_ms, status: String(r.status) })),
     ...logs.map(c => ({ ts: c.started_at, kind: c.status === "error" ? "Error" : "Chat", summary: c.prompt_preview, duration_ms: c.duration_ms, status: c.status })),
   ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200);
   ```
   `classifyRoute` = small inline helper (regex on `/recovery`, `/sleep`).

2. **`StatsRow.tsx`** *(new, server)* — props: `syncLogs`, `chatLogs`. Renders 3 cards. Total syncs: count + 14-day daily-count sparkline (count syncs per day). Last sync: most-recent `syncLogs[0]` start time, "X ago" formatted. Avg duration: mean duration of chat logs + bar histogram of last 15. Mockup lines 297–352. Each card has Roman numeral (01/02/03) and SVG sparkline.

3. **`EventLedger.tsx`** *(new, `"use client"`)* — props: `rows: LedgerRow[]`. Local `useState` for filter pill (default "All"). Filter logic:
   - "All" → all rows
   - "Sync" → kind === "Sync"
   - "Recovery" → kind === "Recovery"
   - "Sleep" → kind === "Sleep"
   - "Error" → kind === "Error"
   Render filter pills with counts + a `<table className="atelier-log-table">` with columns Time · Kind tag · Summary · Duration · Status. Each row clickable to expand `details` in a sub-row (only if `details` non-null).

4. **`logs/page.tsx`** — wrap existing tree:
   ```tsx
   <div className="classic-logs">
     {/* the existing 4-KPI strip + 3 collapsible cards */}
   </div>
   <div className="atelier-logs">
     <StatsRow syncLogs={syncLogs} chatLogs={logs} />
     <EventLedger rows={ledger} />
   </div>
   ```

5. **`theme.css`** — append `.atelier-logs`, `.atelier-stats-row` (3-col grid), `.atelier-stat-card`, `.atelier-spark-svg`, `.atelier-log-toolbar`, `.atelier-log-pill`, `.atelier-log-pill.active`, `.atelier-log-table` (Roman numeral row index, mono cells, hairline borders, sticky header). Tag colors per kind: Sync = ink-mute, Recovery = coral-soft, Sleep = olive, Error = coral. Scope under `:root[data-theme="atelier"]`.

## Code structure (skeletons)

```tsx
// page.tsx — classification helper inline
function classifyRoute(r: RouteLog): LedgerRow["kind"] {
  if (r.status >= 500) return "Error";
  if (r.route.startsWith("/recovery")) return "Recovery";
  if (r.route.startsWith("/sleep")) return "Sleep";
  return "Page";
}
```

```tsx
// EventLedger.tsx
const filters = ["All", "Sync", "Recovery", "Sleep", "Error"] as const;
const [filter, setFilter] = useState<typeof filters[number]>("All");
const filtered = filter === "All" ? rows : rows.filter(r => r.kind === filter);
const counts = filters.reduce((acc, f) =>
  ({ ...acc, [f]: f === "All" ? rows.length : rows.filter(r => r.kind === f).length }),
  {} as Record<string, number>);
```

## Patterns to follow
- DB reads: existing `getChatLogs`, `getSyncLogs`, `getRouteLogs` exports.
- Server merge & sort happens in `page.tsx`; the client component receives final array.
- Atelier classes prefixed `atelier-logs-*` / `atelier-log-*` / `atelier-stat-*`; scoped under `:root[data-theme="atelier"]`.
- No new npm deps.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-logs">` parallel to classic; classic untouched.
- [ ] Atelier Zero tokens (paper bg, Playfair italic, Roman numerals, hairline borders).
- [ ] Real telemetry — stats and ledger render from `chat_logs` / `sync_logs` / `route_logs` tables.
- [ ] No mocks anywhere.

## Verification
- `npm run build` clean.
- whoop-dev up → `/logs` classic unchanged.
- Toggle Atelier → 3 stat cards render with live counts; ledger shows merged events; filter pills toggle visible rows.
- Force a sync error path (or check existing error rows) → "Error" pill count > 0; selecting Error filters correctly.
- agent-browser screenshot atelier `/logs`; compare to `mockup-logs.html`.

## Out of scope (explicit)
- No edits to classic logs components (`ChatLogsTable`, `SyncLogsTable`, `RouteLogsTable`, `CollapsibleCard`).
- No new DB columns.
- No real-time polling — page is server-rendered, data fetched per request like classic.
- No new npm deps.
- No new analytics modules.
