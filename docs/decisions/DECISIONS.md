# Decisions Log

Running log of architectural, scope, and process decisions for the Whoop Dashboard project. Newest entries at the top. Each entry is short — for deep rationale on a single locked decision, write an ADR alongside in `docs/decisions/YYYY-MM-DD-*.md` and reference it here.

Maintained via the `/decisions` skill. See `~/.claude/skills/decisions/SKILL.md` for the entry format and invocation rules.

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
