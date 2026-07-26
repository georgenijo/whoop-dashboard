# bench-coach — Cursor coach latency harness

Times the client-observed segments of a Coach turn served by the Cursor
provider (`/api/chat?stream=true`) and pairs them with the server-side
`details.cursor.timing` breakdown persisted to `chat_logs.details` (spawn →
first event / first assistant text / first tool event / turn end — see the
Cursor lifecycle instrumentation in `apps/web/src/lib/coach/cursor-loop.ts`
and the `DetailState["cursor"]` contract in
`apps/web/src/lib/coach/loop.ts`).

## Prerequisites

1. **A running target instance.** Use the `whoop-dev` skill
   (`~/.claude/skills/whoop-dev/`) to boot one against a private DB snapshot:

   ```bash
   RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh <worktree-path> --port 3100)
   URL=$(echo "$RESULT" | jq -r .url)
   DB=$(echo "$RESULT" | jq -r .db)
   ```

2. **Schema must be bootstrapped.** The app creates `users`, `chat_threads`,
   `chat_messages`, `chat_logs`, `user_settings` etc. lazily, inside
   `openWrite()`, the first time it performs *any* DB write — not at
   startup. If you booted a truly empty DB (rather than a snapshot of an
   already-used one via `whoop-dev`), hit the app once with something that
   writes (sign in through the browser once, or just run this script — the
   first request will 404/401 usefully rather than silently succeed against
   missing tables) before relying on results. `bench-coach.mjs` checks for
   the tables it needs up front and fails with a clear message if they're
   missing, rather than seeding schema itself — schema ownership stays with
   the app (`apps/web/src/lib/db/connection.ts`).

3. **`JWT_SIGNING_KEY`.** The script mints its own session JWT (Bearer path
   of `requireAuth`), so it needs the exact same `JWT_SIGNING_KEY` the
   target server was started with. Resolution order:
   - `JWT_SIGNING_KEY` in this shell's environment, else
   - `--env <path>` if given, else
   - `apps/web/.env` / `.env` relative to *this* checkout.

   In the common case (bench harness and target both point at the same
   worktree checked out via `whoop-dev`), this "just works" since `up.sh`
   copies the main worktree's `.env` into the target worktree.

4. **Cursor provider actually engaged server-side.** The script seeds
   `user_settings.model_pref = 'cursor:composer-2.5-fast'` for its bench user
   (this must stay in sync with `CURSOR_PREF` in
   `apps/web/src/lib/coach/provider.ts`), but `resolveCoachProvider()`
   silently falls back to Anthropic if the target server doesn't have
   `CURSOR_API_KEY` set. The harness no longer lets that slide: after every
   run that streamed successfully it checks the persisted
   `chat_logs.details.provider`, and **aborts the whole bench** if the row is
   missing or its provider isn't `"cursor"`. The error names the likely cause
   (missing `CURSOR_API_KEY` on the target). Confirm `CURSOR_API_KEY` is set
   in the target's `.env` before running.

5. **Precompiled MCP server (optional).** `cursor-loop.ts` only uses the
   `dist/coach-mcp/server.mjs` artifact when `NODE_ENV=production`, so a
   `whoop-dev` target (which runs `next dev`) benches the `tsx` path by
   default. To bench the compiled path, run `npm run build:mcp` in the
   target worktree and start it with `COACH_MCP_USE_COMPILED=1`.

## Usage

```bash
node scripts/bench-coach.mjs --url "$URL" --db "$DB" --runs 5
```

```
node scripts/bench-coach.mjs --url http://localhost:3100 --db /tmp/whoop-dev-3100.db [options]

Required:
  --url <url>        Base URL of the running dev instance (no trailing slash).
  --db <path>        Path to that instance's SQLite DB.

Options:
  --runs <N>         Repetitions per prompt (default 3).
  --prompts <file>   One prompt per line ('#' comments / blank lines skipped).
                      Default: 4 built-in prompts (recovery / sleep / general
                      / 14-day HRV trend).
  --env <path>       .env file to read JWT_SIGNING_KEY from.
  --user-id <N>      Reuse an existing user_id instead of seeding a bench user.
  --apple-sub <str>  apple_sub for the seeded bench user (default
                      "bench-coach-harness"); idempotent across reruns.
  --email <str>      Cosmetic email for the seeded bench user.
  --reuse-thread     Reuse one thread across all runs of a prompt instead of a
                      fresh thread per run (default: fresh thread per run, so
                      results aren't skewed by growing conversation history).
  -h, --help         Show help.
```

## What it measures

Per run, client-side (wall clock from just before the `fetch()` call):

- `ttfb_ms` — time to first byte of the SSE response (any bytes, including
  comment lines). The route now flushes an immediate `: ready` comment frame
  as soon as the stream opens, so **`ttfb_ms` measures that immediate flush**
  — i.e. route entry + auth + stream setup — not any model work. The
  harness's comment-frame skip already ignores `: ready` (and `: hb`
  heartbeats) when looking for real events, so `ttft_ms` is unaffected.
- `ttft_ms` — time to the first `text_delta` SSE event.
- `total_ms` — time to the `done` (or `error`) SSE event.

Then, correlated via the `x-thread-id` response header, it reads the most
recent `chat_logs` row for that thread and pulls from
`details.cursor.timing`:

| column      | field                                          |
| ----------- | ---------------------------------------------- |
| `srv_event` | `timing.spawn_to_first_event_ms`               |
| `srv_text`  | `timing.spawn_to_first_assistant_text_ms`      |
| `srv_tool`  | `timing.spawn_to_first_tool_event_ms`          |
| `srv_total` | `timing.turn_ms`                               |
| `tools`     | count of `cursor.tool_events` with `phase: "completed"` |

The persisted `cursor` object carries considerably more than the harness
prints (`requested_model`/`resolved_model`, `prefetch`, `event_counts`, the
full `tool_events` list, `terminal_subtype`/`terminal_seen`, and finer-grained
timings such as `prompt_build_ms`, `workspace_prep_ms`, `spawn_call_ms`,
`spawn_to_system_init_ms`, `spawn_to_terminal_result_ms`,
`cursor_duration_ms`, `cursor_api_duration_ms`, `spawn_to_process_close_ms`,
`process_close_tail_ms`, `cleanup_ms`); query `chat_logs.details` directly if
you need those.

Individual timing fields print as `n/a` when absent — e.g. an older target
build that persisted a `cursor` object without a `timing` block, or a turn
that produced no tool events. That is *not* fatal. What is fatal is the row
being missing entirely or `details.provider !== "cursor"` on a run that
otherwise succeeded: the bench aborts rather than print plausible numbers for
the wrong provider (see prerequisite 4).

Output is a plain-text table per prompt (one row per run, plus p50/p95),
followed by an aggregate p50/p95 across every prompt when more than one was
run. No HTML/JSON output, no external deps — everything is resolved from
`apps/web/node_modules` (`better-sqlite3`, `jose`) via `createRequire`.

## Known gaps

- `details.cursor.timing` is produced by the target server, not by this
  harness — the `srv_*` columns read `n/a` across the board against any build
  without the Cursor lifecycle instrumentation in `cursor-loop.ts`.
- No warm-up run is excluded automatically; if you want to discard a cold
  first hit, just eyeball run 1 vs. the rest, or bump `--runs` and read the
  p50/p95 line instead of individual rows.
- Bench runs always create real `chat_threads` / `chat_logs` rows in the
  target DB (there's no dry-run mode) — fine against a throwaway
  `whoop-dev` snapshot, not something to point at a real production DB.
