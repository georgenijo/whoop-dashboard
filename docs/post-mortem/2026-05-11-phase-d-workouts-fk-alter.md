# 2026-05-11 — Phase D workouts ALTER threw under FK=ON, silently broke all write paths

**Status:** resolved
**Owner:** George
**Affected window:** ~21:30 UTC (deploy of #324) → ~22:25 UTC (#325 deployed + migration completed)
**Surfaces hit:** every `openWrite()` caller — `/api/sync`, OAuth callback (`/api/auth/callback`), `/api/auth/login` session writes, chat message persistence, webhook DLQ inserts
**Severity:** P1 for writes (silently returned null; nothing landed); P3 for reads (kept working via the separate read-only `open()` path)

## Tl;dr

Phase D's `workouts` schema migration runs an `ALTER TABLE workouts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)` **outside** the `foreign_keys = OFF` block that wraps the four PK-rebuilds. SQLite rejects an `ADD COLUMN` with `REFERENCES` + non-NULL DEFAULT while FK enforcement is on:

```
SqliteError: Cannot add a REFERENCES column with non-NULL default value
```

`openWrite()` re-enables FK on every connection (line 21). So the ALTER threw on prod, the bare `catch {}` in `openWrite()` swallowed it, and the function returned `null`. Reads kept working (different open path); every write call silently no-op'd.

The first four PK-rebuilds had already committed in their own FK-off transactions before the throw, leaving prod in a well-defined partially-migrated state: `recovery`/`cycles`/`sleep`/`daily_summary` on composite `(user_id, date)`, `workouts` still pre-Phase-D.

## What broke

| Symptom | Where |
|---|---|
| `openWrite()` returned `null` on every invocation | All write callers — sync, auth, chat, webhooks |
| `/api/sync` silently no-op'd | `runWhoopSync` → `persistAll` → `openWrite()` → null → returned early |
| OAuth `/api/auth/callback` couldn't write the integrations row (would have, had anyone tried mid-incident) | DB |
| `/api/dashboard/today` still returned 200 with data | Reads use `safeQuery` → `open()` (read-only), unaffected |
| iOS app reads unaffected | Same — reads route through `forUser(uid).all/get()` → `open()` |
| Journal had no error trace | `catch {}` was bare; the throw was eaten without logging |

## Timeline (UTC, 2026-05-11)

| Time | Event |
|---|---|
| ~17:30 EDT | Pre-deploy DB backup taken locally: `~/whoop_data.db.backup.20260511-173108` (1.34 MB). |
| ~17:30 EDT | PR #324 squash-merged as `d5a5623`. |
| ~17:32 EDT | VM `git pull origin main` + `npm ci` + `npm run build` + `systemctl restart whoop-web`. Service reports `active`, "Ready in 727ms". No errors at boot. |
| ~17:32 EDT | Curls to `/api/dashboard/today` return 401 (auth-gated even on localhost) — can't directly trigger `openWrite()` from outside. |
| ~17:35 EDT | `tsx scripts/backfill-whoop-provider-user-id.ts` reports `[backfill] openWrite returned null — DB unreadable`. First sign something's wrong. |
| ~17:38 EDT | Direct schema dump via Python: recovery/cycles/sleep/daily_summary already on composite PK (rebuilds committed), workouts still pre-Phase-D, integrations has `provider_user_id` column. State partially migrated. |
| ~17:43 EDT | Patched `openWrite()`'s bare catch on the VM (`console.error(err)`); reran trigger script. Error surfaced: `SqliteError: Cannot add a REFERENCES column with non-NULL default value at rebuildDomainTablesForUserId (connection.ts:624)`. |
| ~17:48 EDT | Diagnosed: workouts ALTER outside the FK-off block. Reverted VM patch, wrote one-line fix + regression test locally. |
| ~17:50 EDT | Verified the new test fails on `main` without the fix (stash-pop method), passes with it. 241/241 vitest + clean build. |
| ~17:54 EDT | PR #325 opened. whoop-reviewer: 0 blockers, 2 non-blocking nits. |
| ~18:08 EDT | PR #325 squash-merged as `d92e2d1`. Pull + rebuild + restart on VM. |
| ~18:20 EDT | Trigger script re-run on VM: `openWrite ok`. Schema verification: all 5 domain tables `user_id`-scoped, 5 composite indexes present, every row backfilled to `user_id=1`. |
| ~18:25 EDT | Journal clean; service serving requests; write paths restored. Declared GO. |

Total window: ~55 minutes from initial deploy to full Phase D state on prod. Writes were silently broken for the duration. Reads stayed available the whole time.

## Root cause

Per https://sqlite.org/lang_altertable.html:

> If foreign key constraints are enabled and a column with a REFERENCES clause is added, the column must have a default value of NULL.

`openWrite()` enables FK on every connection:

```ts
db = new Database(p, { fileMustExist: true });
db.pragma("foreign_keys = ON");   // ← line 21
```

The PK-rebuild loop for `recovery`/`cycles`/`sleep`/`daily_summary` correctly turns FK off for the duration of each rebuild:

```ts
db.pragma("foreign_keys = OFF");
try {
  const tx = db.transaction(() => { /* CREATE/INSERT/DROP/RENAME/INDEX */ });
  tx();
} finally {
  db.pragma("foreign_keys = ON");
}
```

But the `workouts` block — added *after* the loop because the table doesn't need a PK rebuild — was a bare ALTER:

```ts
// BEFORE (buggy)
if (!hasColumn(db, "workouts", "user_id")) {
  db.exec(
    "ALTER TABLE workouts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"
  );
}
```

FK was ON. SQLite refused at parse time. The bare `catch {}` in `openWrite()` swallowed the throw and returned null.

## Why tests didn't catch it

The existing `connection.test.ts` calls `openWrite()` against a fresh empty DB file on every test:

```ts
function newDbFile(): string {
  const file = path.join(tmpRoot, `db-${Math.random()...}.db`);
  new Database(file).close();
  return file;
}
```

In that flow:

1. `openWrite()` opens the empty file.
2. Schema bootstrap runs `CREATE TABLE IF NOT EXISTS workouts (...)` — creates the table fresh, with the old (pre-Phase-D) shape, no `user_id`.
3. `rebuildDomainTablesForUserId()` runs.
4. The workouts ALTER fires — but on a **freshly created**, **empty** table.

Critically — and this is the part I didn't expect — `ALTER TABLE ... ADD COLUMN` is a parse-time rejection in SQLite, independent of whether the table has rows. So this *should* have thrown in tests too. We confirmed that on `main` (post-fix) by stash-popping the fix and re-running the new regression test — it failed exactly as prod did. The pre-fix tests passing on local was effectively a fixture-ordering coincidence: every test was creating its own fresh DB and the workouts table didn't yet exist in a state where the ALTER would be reached against a pre-bootstrap-existing schema. The new regression test pre-creates `workouts` from a separate `Database()` connection with `foreign_keys = ON` and *then* calls `openWrite()` — that's the prod path, and that's what trips the bug.

The deeper lesson: when a migration's correctness depends on the *prior* schema state, the fixture must seed that state separately from the code under test. Letting the code under test create its own fixture hides bugs the migration only hits against pre-existing schemas.

## Detection

Three things slowed detection:

1. **`openWrite()` returns `null` instead of throwing.** Callers that already handle null (most do — DB-missing is a documented case) silently no-op. There was no surface signal that anything was wrong.
2. **Reads kept working.** Dashboards, Coach, `/api/dashboard/today` all rendered. Only a write attempt would have surfaced the issue, and the deploy window didn't include one.
3. **Journal was silent.** The bare `catch {}` ate the error. No `migration failed`, no stack trace, nothing.

What surfaced it: the deploy verification script ran the new `backfill-whoop-provider-user-id.ts` tsx script, which logs `[backfill] openWrite returned null — DB unreadable` when openWrite returns null. That was the only signal.

Without that script in the verification matrix, the bug would have been discovered the next time George clicked Sync or the daily webhook attempted to write.

## Resolution

PR #325 (`d92e2d1`):

```ts
// AFTER (fixed)
if (!hasColumn(db, "workouts", "user_id")) {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(
      "ALTER TABLE workouts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"
    );
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
```

Also surfaced the `openWrite()` catch:

```ts
} catch (err) {
  console.error("[openWrite] migration failed:", err);
  db?.close();
  return null;
}
```

Regression test: `connection.test.ts` → `"workouts ALTER survives a pre-existing table when foreign_keys=ON"`. Pre-creates `users` + `workouts` in a separate connection with FK enforced, then invokes `openWrite()` and asserts the migration completes + backfills `user_id=1` + FK pragma is restored.

## Lessons / followups

1. **Fixtures must match prod state, not just exercise the code path.** The Phase D unit test suite all passed against fresh DBs. The bug only manifested against a pre-existing schema. Going forward, schema-migration tests that touch ALTER paths should pre-create the relevant tables in a separate connection so the migration runs in the "table exists, FK on" mode that prod actually presents.

2. **Silent catches in critical paths are debt.** The `openWrite()` `catch {}` predates Phase D; this is the first incident where it hid a migration bug. The hotfix adds `console.error` but keeps the `return null` contract (callers already depend on it). A longer-term move would be to narrow the catch — let migration errors throw, keep null only for genuine "can't open file" cases — but that's a separate refactor, not a hotfix.

3. **SQLite FK + ALTER ADD COLUMN restriction is non-obvious.** Documented at https://sqlite.org/lang_altertable.html: *"If foreign key constraints are enabled and a column with a REFERENCES clause is added, the column must have a default value of NULL."* The Phase D PK-rebuild block knew to disable FK; the standalone ALTER was added later and missed the same guard. Worth a `// SQLITE_FK_DISABLE_REQUIRED` style comment anywhere we ALTER ADD COLUMN with REFERENCES in the future.

4. **Pre-deploy backups paid for themselves.** Even though we didn't need to roll back, having `~/whoop_data.db.backup.20260511-173108` locally during the diagnostic window meant we could fix-forward confidently. The CLAUDE.md `Deploy` section's backup recipe (added in the same PR as Phase D) was the right addition.

5. **Verification scripts catch what 401s hide.** The post-deploy curl to `/api/dashboard/today` returned 401 (auth-gated even on localhost behind nginx). That's correct, but it means the curl doesn't exercise the write path. The `backfill-whoop-provider-user-id.ts` tsx script — which has its own connection and bypasses HTTP auth — was the actual smoke that found the bug. Keep that in the standard post-deploy matrix for any schema-touching deploy.

6. **Phase D's `forUser()` wrapper, composite PKs, and webhook user mapping all shipped correctly.** The incident was scoped to a single ALTER statement. The Phase D design is sound; the implementation had a one-line miss.

## References

- PR #323 (issue), #324 (Phase D), #325 (hotfix)
- Decisions log: `docs/decisions/DECISIONS.md` — 2026-05-11 Phase D kickoff + provider_user_id entries
- Hotfix commit: `d92e2d1`
- SQLite altertable docs: https://sqlite.org/lang_altertable.html
