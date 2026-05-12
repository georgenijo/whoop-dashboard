# Decisions Log

Running log of architectural, scope, and process decisions for the Whoop Dashboard project. Newest entries at the top. Each entry is short — for deep rationale on a single locked decision, write an ADR alongside in `docs/decisions/YYYY-MM-DD-*.md` and reference it here.

Maintained via the `/decisions` skill. See `~/.claude/skills/decisions/SKILL.md` for the entry format and invocation rules.

---

## 2026-05-11: Migrate uid=1 → uid=2 domain data (post-Phase-D fallout)

**Decision:** Executed one-shot migration `apps/web/scripts/migrate-uid1-to-uid2.ts` against prod. For each composite-PK table (`recovery`, `sleep`, `cycles`, `daily_summary`): DELETE uid=1 rows whose `date` already exists on uid=2 (uid=2 wins — post-reconnect data is fresher) + UPDATE remaining uid=1 rows → uid=2. For `workouts` (PK=`id`): straight UPDATE (no overlap possible). Final pass: `recomputeDailySummary` for every uid=2 date with recovery/sleep/cycles but no summary row. Moved 482 domain rows (recovery 145, sleep 148, cycles 150, daily_summary 12, workouts 37) + recomputed 138 daily_summary rows. Pre-deploy backup at `~/whoop_data.db.backup.20260511-194420` (1.56 MB).

**Rationale:** Phase D's `ALTER TABLE ... ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1` correctly assigned all pre-Phase-D rows to uid=1, but uid=1 hasn't been the active user since the 2026-05-09 SIWA cutover ([[cross_device_user_split]]) — George's web + iOS sessions both resolve to uid=2. The "cross-device split RESOLVED" memory marked the auth side complete but the data was never migrated; Phase D made the split user-visible ("only last week's data" reports). Migration is the actual completion of the cross-device unification. uid=1 retained in `users` table as bootstrap placeholder until Phase B-cleanup removes the `getPrimaryUser()` id=1 hardcoding at `apps/web/src/lib/db/auth.ts:59`.

**Status:** active

**References:** `apps/web/scripts/migrate-uid1-to-uid2.ts`, memory `cross_device_user_split.md`, PR #324 (Phase D), `apps/web/src/lib/db/auth.ts:59`

---

## 2026-05-11: Phase D kickoff — PK rebuild for 4 domain tables, no operational fence, 6-step execution

**Decision:** Phase D (issue #323) scopes to: (1) add `user_id` to `recovery`, `cycles`, `sleep`, `workouts`, `daily_summary` — for `recovery`/`cycles`/`sleep`/`daily_summary` the new PK is composite `(user_id, date)`, requiring a `CREATE TABLE _new` + `INSERT SELECT 1, ...` + `DROP` + `RENAME` rebuild gated by a `PRAGMA table_info` "no user_id col" check; `workouts` stays simple ALTER (PK = `id`). (2) Build `apps/web/src/lib/db/scoped.ts` `forUser(userId)` wrapper — params-only binding, no SQL parsing, call-site writes `... AND user_id = ?` as the **last** placeholder. (3) Thread `userId` through all `upsert*`, `delete*AndRecompute`, `recomputeDailySummary` and call sites. (4) Migrate every domain `safeQuery` in `lib/db/{recovery,sleep,strain,workouts,summary,prs,body}.ts` + coach `query_*` branches + dashboard page handlers. (5) CI assertion = vitest test that greps for `FROM|JOIN|INTO|UPDATE|DELETE FROM (recovery|cycles|sleep|workouts|daily_summary|body_measurements)` outside an allowlist (`scoped.ts`, `connection.ts`, `upsert.ts`, `sync.ts`). (6) Webhook user mapping via new `integrations.provider_user_id` column (see separate decision below). Scope item #8 (lift operational fence) **dropped** — pre-impl review found no fence exists; webhook hardcoded `userId = 1` at `webhook-handler.ts:40` is the only approximation and item #7 already replaces it.

**Rationale:** Architect + Plan agents converged on this shape. PK rebuild is unavoidable for multi-tenant correctness: keeping `date PRIMARY KEY` would let user 2's `2026-05-11` row collide with user 1's via `INSERT … ON CONFLICT(date) UPDATE`, overwriting silently. Few-thousand-row tables make the rebuild sub-second. Params-only wrapper avoids SQL-parser fragility (CTEs, UNIONs, JOINs) — call-site discipline plus the CI assertion is the safety net. `body_measurements` already shipped this shape (PR #283) and stays unchanged structurally, but folds into the wrapper for read consistency. Coach tools already plumb `userId` into `executeTool({ userId })` (PR #322) — only the five `query_*` branches at `tools.ts:358-384` need to pass it into the read fns.

**Status:** active

**References:** issue #323, Plan agent + whoop-architect outputs (Phase D pre-impl), PRs #318/#322, `docs/architecture-scalable.html` (Phase D section)

---

## 2026-05-11: Phase D — `provider_user_id` captured in OAuth callback + lazy backfilled on sync

**Decision:** Add `provider_user_id TEXT` column + `idx_integrations_provider_user(provider, provider_user_id)` to `integrations`. Capture path: (a) primary — in `/api/auth/callback/route.ts` right after `exchangeCode()` succeeds, call `getWhoopProfile({ userId })` against `/v2/user/profile/basic` (not `/v1` — issue text was wrong; Python client at `streamlit/whoop/client.py:57` confirms `/v2`) and `setProviderUserId(userId, "whoop", String(profile.user_id))`. Wrap in try/catch — log + continue on failure, **do not fail the OAuth flow**. (b) lazy backfill — every `runWhoopSync({ userId })` checks if the integration row's `provider_user_id IS NULL` and, if so, fetches the profile and populates. (c) one-shot — `scripts/backfill-whoop-provider-user-id.ts` for the maintainer's existing row pre-deploy. Webhook handler at `webhook-handler.ts:36-40` replaces the hardcoded `userId = 1` with `lookupUserIdByProvider("whoop", String(evt.user_id))`; on miss returns `{ kind: "noop", reason: "unknown_whoop_user" }` (200 status — Whoop won't retry).

**Rationale:** Belt-and-suspenders. Callback fetch makes the mapping live the instant a user connects — webhook events for that user route correctly from t=0. Lazy backfill is the resilience layer: a callback that succeeded the OAuth exchange but tripped on the profile call (network blip, Whoop 5xx) gets repaired automatically on the user's next sync without manual intervention. Either alone would leave a gap (callback-only: stuck until manual fix; lazy-only: every webhook between connect-and-first-sync is a `noop`, which is recoverable via Whoop's 5× retry but ugly). Token-exchange response does NOT include the Whoop user_id (confirmed against `apps/web/src/lib/auth.ts:89-95` and the Python client) so a separate API call is required either way.

**Status:** active

**References:** issue #323, `apps/web/src/lib/whoop/client.ts`, `apps/web/src/app/api/auth/callback/route.ts`, `apps/web/src/lib/db/integrations.ts`, `streamlit/whoop/client.py`

---

## 2026-05-11: Phase C-minimum further reduced — existing dual-write infrastructure means smaller delta than scoped

**Decision:** Pre-implementation review of issue #320 found four pieces already shipped beyond the Phase A snapshot: `getValidAccessToken()` reads from `integrations` first, `saveTokens()` dual-writes to `integrations` + `tokens.json`, `/api/connectors/whoop` returns status, `/api/auth/whoop/disconnect` deletes the row. The remaining Phase C-minimum work is: (1) parameterize `DEFAULT_USER_ID` through the token/sync stack, (2) add HMAC state to the existing `/api/auth/callback` so user_id survives the redirect, (3) add `WHOOP_STATE_SECRET` env with fail-closed loader. **No new `/api/whoop/*` routes** — extend existing surface.

**Rationale:** Architecture review found the original issue text would have introduced parallel `/api/whoop/auth/*` routes alongside the working `/api/auth/callback` route — a "loaded gun" leaving a stale unsigned-state route in production. Pattern-matches the Phase A surprise where `integrations` table + core vault had already shipped in PR #65. Better to extend than parallel-implement.

**Status:** active

**References:** issue #320 (rescoped), architect review (a86487a00b7424563), `apps/web/src/lib/whoop/token.ts`, `apps/web/src/lib/auth.ts`, PR #318

---

## 2026-05-11: Phase C un-bundled — minimum scope = 3 items, Phase D moves out

**Decision:** Phase C ships in two cuts. **Phase C-minimum** (~2 days) is the OAuth-only slice: `/api/whoop/auth/start`, `/api/whoop/auth/callback`, refactor `runWhoopSync(userId)` to read tokens from the `integrations` table, one-shot migration of `tokens.json` → `integrations` row, Settings UI Connect/Disconnect. **Phase D** (~2–3 days, separate issue) adds `user_id` columns to `recovery` / `cycles` / `sleep` / `workouts` / `daily_summary`, the `forUser()` wrapper, and backfill to `user_id=1`.

**Rationale:** The earlier scope bundled the per-user-OAuth work (genuinely required) with the per-user-data work (separately useful but not required for OAuth to function). Un-bundling lets us ship the Whoop Connect/Disconnect UX, retire `tokens.json`, and land the encrypted token storage as one coherent feature without dragging schema migration of five domain tables behind it. Caveat: after Phase C-minimum but before Phase D, two users syncing simultaneously would still collide at the row level (no `user_id` on domain tables). Acceptable because the only active syncing user today is the maintainer; Phase D follows immediately.

**Status:** active

**Supersedes:** the earlier 2026-05-11 entry below

**References:** `docs/architecture-scalable.html` Phase C, Phase D

---

## 2026-05-11: Phase C scope locked — shared Whoop app, web-only OAuth, one-shot migration

**Decision:** Phase C (per-user Whoop OAuth) will use one shared Whoop developer app for all users, route OAuth through the web app only (not native iOS), migrate `tokens.json` to an `integrations` row via a one-shot script, and backfill all existing recovery/cycles/sleep/workouts/daily_summary rows to `user_id=1` (legacy single-user). `user_id=2` (SIWA path) starts fresh.

**Rationale:** Shared dev app matches the scalable architecture doc's "shared client_id rate budget (hosted)" path and sidesteps per-user Whoop app registration friction. Web-only OAuth keeps the flow simple — iOS users do the one-time Whoop connect via the web app, then iOS reads synced data. Native iOS OAuth via `ASWebAuthenticationSession` is a future option, not worth the cost for a one-time flow. Backfilling to `user_id=1` honors the existing memory note that pre-cutover data stays with the legacy user.

**Status:** superseded by 2026-05-11 (un-bundled into Phase C-minimum + Phase D)

**References:** `docs/architecture-scalable.html` (Phase C section), memory `cross_device_user_split.md`

---

## 2026-05-11: Phase B cleanup gated on Phase C + D

**Decision:** Defer Phase B cleanup items (drop CF Access on public domain, kill `getBootstrapUser()` fallback in `requireAuth()`, build `/signup` screen) until Phase C and Phase D land first.

**Rationale:** Dropping CF Access today exposes the public URL while the bootstrap fallback still resolves to `user_id=1` — anyone hitting `/` would see the maintainer's data. Killing the bootstrap fallback today breaks the SIWA path because sync data is still keyed to `user_id=1` while logged-in users are `user_id=2`. Both items are only safe once per-user Whoop OAuth + data isolation are in place.

**Status:** active

**References:** `docs/architecture-scalable.html` Phase B, memory `cross_device_user_split.md`

---

## 2026-05-11: Phase ordering — A → C → D → B-cleanup → E → F (not alphabetical)

**Decision:** Execute the scalable architecture phases in dependency order, not alphabetical order. Phase A (foundation tables + encryption) first, then Phase C (per-user Whoop OAuth), then Phase D (data isolation audit), then Phase B cleanup (drop CF Access, kill bootstrap, `/signup`), then Phase E (onboarding UX), then Phase F (packaging, optional).

**Rationale:** The scalable doc lists phases alphabetically but the real dependency graph isn't. Phase A is the foundation everything else writes to. Phase C needs A's `integrations` table. Phase D needs C's `user_id`-stamped data to wrap. Phase B cleanup needs all of the above to be safe to ship. Phase E is UX on top of working multi-tenant plumbing. Phase F is packaging the result.

**Status:** active

**References:** `docs/architecture-scalable.html`, `memory/project_direction.md`

---

## 2026-05-11: Project direction — scalable BYOK multi-tenant (supersedes life-intelligence framing)

**Decision:** The project direction is the scalable, BYOK (bring-your-own-key), multi-tenant architecture documented in `docs/architecture-scalable.html`. Future users sign in with Apple, connect their own Whoop OAuth, drop in their own Anthropic key, and have a working dashboard.

**Rationale:** The previous "life intelligence platform / magic-feature (stress-after-meeting)" framing — captured in `memory/project_direction.md` pre-2026-05-11 — was building features on top of a single-tenant base that can't be shared. Useful work was completed under that framing (iOS scaffold, Coach tool-use, APNs foundation) but it was the wrong organizing principle. The product should be portable, not tied to one Whoop account, one Anthropic key, one CF Access allowlist entry.

**Status:** active

**References:** `docs/architecture-scalable.html`, `docs/architecture-current.html`, `memory/project_direction.md` (rewritten 2026-05-11)

---

## 2026-05-11: Rebuild docs (`docs/rebuild/PLAN.md`, `GUIDE.md`) marked stale

**Decision:** Treat `docs/rebuild/PLAN.md` and `docs/rebuild/GUIDE.md` as historical artifacts. They describe the Streamlit → Next.js rebuild, which shipped. They do not describe current direction.

**Rationale:** GUIDE.md last updated 2026-04-23 and says "Phase 1 active" but Phases 1–4 of the rebuild all shipped: Next.js live, Coach with tool-use, mobile nav, Streamlit relegated to legacy. Reading them as current guidance produces wrong answers about where the project is. The current direction lives in `docs/architecture-scalable.html` (target) and `docs/architecture-current.html` (snapshot).

**Status:** active

**References:** `docs/rebuild/PLAN.md`, `docs/rebuild/GUIDE.md`, `docs/architecture-scalable.html`

---

## 2026-05-11: Encryption strategy — tweetnacl + single `VAULT_KEY` env (sealed-box symmetric)

**Decision:** Use the existing `tweetnacl` library for token/secret encryption with a single `VAULT_KEY` environment variable (32 bytes base64). Rotation strategy: re-encrypt all rows under a new key. Issue #319 tracks setting `VAULT_KEY` on the VM before Phase C deploys.

**Rationale:** `tweetnacl` was already in `apps/web/package.json` from PR #65 and shares on-disk wire format with `streamlit/whoop/vault.py` (PyNaCl, both libsodium-derived). Switching to `libsodium-wrappers` for parity with the scalable doc would have required parity-rechecking the Python side for no functional benefit — both libraries are byte-compatible. Per-user derived keys and SQLCipher whole-DB encryption (the other two options in the scalable doc's open decisions) add complexity for an isolation guarantee that doesn't apply at current scale.

**Status:** active

**References:** PR #318, PR #65, `apps/web/src/lib/crypto/vault.ts`, `docs/architecture-scalable.html` (open decisions §3), issue #319

---

## 2026-05-11: Add `anthropic_key_version` column to `user_settings`

**Decision:** `user_settings` table includes an `anthropic_key_version INTEGER` column alongside the encrypted `anthropic_key` BLOB. Mirrors the existing `integrations.key_version` column on the sibling table.

**Rationale:** Without a version column, the decrypt path can't distinguish "rotated key, re-encrypt needed" from "corrupted ciphertext / wrong key" — both manifest as a Poly1305 MAC failure. Phase E's rotation tooling will walk both `integrations` and `user_settings`; keeping the two encryption-bearing tables structurally symmetric simplifies that future walk. The cost is one nullable INTEGER column on a single-row-per-user table — effectively free.

**Status:** active

**References:** PR #318, `apps/web/src/lib/db/user_settings.ts`, `apps/web/src/lib/db/integrations.ts`

---

## 2026-05-11: Issue #316 Coach-disconnect fix — Option A (persist partial on abort)

**Decision:** For the bug where Coach prompts disappear when the client disconnects mid-turn (iOS app backgrounding, web refresh), implement the partial-persist fix: on `abort`, commit whatever blocks the loop has accumulated with a `status='aborted'` marker. The turn does not continue in the background after disconnect.

**Rationale:** Matches consumer-LLM chat parity (claude.ai, ChatGPT default chat). Option B (detached turn worker that survives disconnect and is resumable on app reopen) is the right long-term answer but needs a turn-state table, worker lifecycle, reconnect protocol, and orphan GC — moderate scope. Option A is ~1 day, addresses the worst symptom (prompt vanishing entirely), and doesn't preclude shipping Option B later. For a personal-use dashboard, parity with claude.ai is the honest bar.

**Status:** active

**References:** issue #316, `apps/web/src/app/api/chat/route.ts`

---

## 2026-05-11: Defer #274b (Whoop-disconnect push); retain #274c (iOS reconnect button)

**Decision:** Mark issue #274b (`needs_reauth` 0→1 detection + "Whoop disconnected" push notification) as deferred — fold into the Pillar E rules engine pattern when issue 4-D (stress-after-meeting) lands. Keep issue #274c (iOS Settings tab reconnect button) on the immediate slate as a small UX gap fix.

**Rationale:** #274b is one instance of the "system notices X → send push" pattern; building it now in isolation means throwaway one-off code when the rules engine forces a uniform pattern later. #274c is independent — without a reconnect button, iOS users have no path to re-auth Whoop from the app, which is a real gap unrelated to push infrastructure. Note: this decision predates the project-direction shift to scalable BYOK. With the shift, both items move to the post-Phase-D iOS surface polish queue; revisit when iOS surface work resumes.

**Status:** deferred

**References:** issue #274b, issue #274c, PR #283 (APNs foundation), `memory/project_direction.md`

---
