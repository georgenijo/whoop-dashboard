# ADR: Coach does not add or migrate a second agent runtime (yet)

- **Date:** 2026-11-28
- **Issue:** #554 (parent epic #549; architecture spike #537)
- **Status:** active. Outcome: **keep Anthropic as-is and add nothing**, with named reopen triggers.
- **Scope:** decision only. No runtime code, dependency, provider setting, model-picker, or deploy change.

## 1. Question

Coach runs two providers behind one internal runner
(`apps/web/src/lib/coach/provider-runner.ts`):

| Provider | Transport today | Owner of the agent loop |
| --- | --- | --- |
| Anthropic | Direct Messages API through `@anthropic-ai/sdk` 0.91, in the Next.js process (`loop.ts`) | Coach |
| Cursor | Persistent `cursor-agent acp` sessions (`cursor-acp-runtime.ts`, `cursor-acp-registry.ts`), legacy one-shot path still present behind `COACH_CURSOR_TRANSPORT` until #553 lands | Cursor |

The question from #554: should Coach add a second *native agent runtime*
(Claude Agent SDK, Claude ACP adapter, OpenAI Responses/Agents, Codex
app-server, or a generic ACP wrapper), or migrate Anthropic onto one? "Do
nothing" is a valid outcome. Protocol symmetry is not a reason.

## 2. Product problems a second runtime would have to solve

These are the only concrete problems that came up when reviewing the code,
the open issues, and the Decisions Log. Each option below is scored against them.

| # | Candidate problem | Is it real today? |
| --- | --- | --- |
| P1 | **Access to OpenAI (GPT) models in Coach.** | Already solved. The Cursor ACP catalog returned 35 account-authorized models including GPT-5.6 Luna, and an end-to-end Luna turn completed two Whoop MCP calls (Decisions Log 2026-08-18, PR #543/#546/#547). |
| P2 | **Direct OpenAI billing / BYOK** (spend against an OpenAI key rather than Cursor). | No open issue or request asks for this. #446 is about attributing the *shared Cursor* key, not about adding OpenAI. |
| P3 | **Use a ChatGPT or claude.ai subscription instead of metered API keys.** | Not permitted for a hosted product (see §4.2 and §4.4). Not a valid goal. |
| P4 | **Less app-owned loop code** (retries, tool-iteration cap, catalog checks, prompt caching, prefetch). | Small. The Anthropic loop is ~620 lines with deterministic tests; the hard parts (tenant scoping, the tool cap, the sync cooldown, presentation validation) stay app-owned whatever the runtime. |
| P5 | **Server-side session state** (resume or fork a conversation without resending history). | Coach's canonical history is `chat_messages` in SQLite, rebuilt every turn and shared by web and iOS. A provider-owned transcript would be a second source of truth, not a benefit. |
| P6 | **Coding-agent features** (shell, file edit, web fetch, subagents). | Explicitly unwanted. Coach denies built-in shell, write, read, and web tools on Cursor and exposes only the private Whoop MCP allowlist (Decisions Log 2026-08-18). |
| P7 | **Reliability or latency.** | Anthropic is not the unreliable path. Open reliability work (#475, #552, #550, #489) is on the Cursor side or on routing. |

No problem on this list needs a new runtime. P1 is already met, P3 is
disallowed, P5 and P6 run against Coach's own contracts, and P2, P4, and P7 do
not hold up on the evidence above.

## 3. Coach constraints every option must respect

From the current code and active decisions:

- **Tenant scoping.** `userId` is server-derived. The Anthropic path calls `executeTool({ userId })` in-process. The MCP bridge pins `COACH_MCP_USER_ID` and `WHOOP_DB_PATH` outside model control (`apps/web/src/coach-mcp/server.ts`).
- **Tool boundary.** There is one tool surface for every model (Decisions Log 2026-08-18, "model choice does not remove core tools"). That surface includes the guarded `trigger_whoop_sync`/`save_workout_plan` writes and a 12-call cap. Per-turn guards reset through a server-controlled epoch.
- **Authoritative tool audit.** The app owns NDJSON audit events. Provider notifications are only hints (Decisions Log 2026-08-30).
- **SSE contract.** The route emits `text_delta`, `tool_use_start`, `tool_progress`, `tool_use_end`, `done`, and `error` (`apps/web/src/app/api/chat/route.ts:399-510`). Partial messages persist on abort (`createCoachTurnHandle` in `persistence.ts`).
- **Persistence and work logs.** `runAndPersistCoachTurn` is the only writer of `chat_messages`/`chat_logs`. Adapters return normalized data (#537 §1).
- **Presentation blocks.** Providers propose blocks. The server validates them (Decisions Log 2026-08-18).
- **Explicit provider choice.** There is no silent fallback across providers, and catalogs are credential-scoped (Decisions Log 2026-11-04).
- **Production runtime.** Node 20.20.2 (`apps/web/package.json` engines, `.nvmrc`). The single `whoop-web` systemd service on `opti` holds the Cursor ACP child processes inside its cgroup. #475 recorded reclaim-at-limit stalls when that cgroup was capped at 512 MB on the old VM. The opti limit was not re-measured in this spike.

## 4. Options evaluated

All capability claims below come from vendor primary documentation,
**accessed 2026-11-28**. Each vendor URL is listed in §8.

### 4.1 Current direct Anthropic Messages SDK loop (baseline)

- **Support:** this is Anthropic's official client SDK (`@anthropic-ai/sdk`). Anthropic's Agent SDK overview describes the Client SDK as "direct access to the Claude API… You write the tool loop yourself, or let the client SDK's beta tool runner drive it." [A1]
- **Auth/BYOK:** per-request API key, already resolved personal-key-first with an origin for 401 banners (`BadApiKeyError`, `api-key.ts`).
- **Runtime:** in-process HTTP. No child process and no disk state.
- **Model discovery:** the account Models API (`anthropic-models.ts`), cached briefly per credential digest.
- **Sessions/cancel:** stateless. History is rebuilt from SQLite, and `AbortSignal` is passed to `messages.stream`.
- **Tools/MCP:** Coach executes `TOOLS` directly and does not need MCP.
- **Streaming:** raw stream events mapped to the SSE contract.
- **Usage:** exact `usage` per response, including cache-read/cache-write tokens (`loop.ts` `addUsageTotals`).
- **Isolation:** nothing to isolate beyond the request.
- **Operational cost:** none beyond tokens.
- **Product benefit:** this is the reference path. Every constraint in §3 already holds here.

### 4.2 Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

- **Support:** official, TypeScript and Python. It gives "the same tools, agent loop, and context management that power Claude Code" and "runs the Claude Code binary." [A1]
- **Auth/BYOK:** API key (or Amazon Bedrock / Google Cloud endpoints) [A3]. "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." [A1] BYOK therefore means the same Anthropic API key Coach already uses. The subprocess "reads `ANTHROPIC_API_KEY` from its environment" [A3], so a per-user key means a per-user subprocess environment.
- **Runtime:** "The Agent SDK spawns and supervises a `claude` CLI subprocess that owns a shell, a working directory, and session files on disk… One agent session maps to one subprocess." [A3] It requires Node.js 18.14+ and bundles a native binary as an optional dependency [A3, A2]. That is compatible with Node 20.20.2, but it adds a second native binary to deploy and canary, like the Cursor launcher canary. The hosting guide suggests "1 GiB RAM, 5 GiB disk, and 1 CPU per agent" as a starting point [A3].
- **Model discovery:** `supportedModels()` / `initializationResult().models` [A2]. This is a second catalog authority alongside the Models API that Coach uses today.
- **Sessions/cancel:** `resume`, `forkSession`, and `persistSession`, with transcripts as JSONL under `~/.claude/projects/` unless a `SessionStore` is configured. `interrupt()` works "only in streaming input mode", and `abortController`/`close()` terminate the process [A2, A3].
- **Tools/MCP:** in-process MCP via `createSdkMcpServer()`, `strictMcpConfig`, `disallowedTools` [A2]. These would let the existing `TOOLS`/`executeTool` be exposed without a stdio bridge. But `allowedTools` "does not restrict Claude to only these tools" [A2], so every built-in tool must be removed explicitly and permission mode pinned, or Coach gains shell/file/web access by default.
- **Isolation:** by default the SDK "reads settings and `CLAUDE.md` memory files from the filesystem… those files can leak one tenant's context into another tenant's session." Isolation requires `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR`, and a per-tenant `cwd` [A3]. Getting any of these wrong would load the service user's own `~/.claude` settings or memory into a Coach turn.
- **Streaming/usage/observability:** `includePartialMessages` for deltas [A2]. Cost and usage come from the SDK, and OTEL export is configured from the environment [A3]. This maps onto SSE, but the event model is Claude Code's (assistant/user/system/result messages), not the raw Messages stream.
- **Coach mapping:** the provider loop, iteration cap, retries, prefetch, and prompt-cache placement would become provider-owned. Coach would still have to own tenant scoping, the tool cap, audit events, presentation validation, and persistence. So the migration adds a process registry like Cursor's without removing the hard parts.
- **Product benefit:** none named. P5 and P6 are the features it adds, and §2 rejects both.
- **Verdict:** **unnecessary.**

### 4.3 Claude ACP adapter (`zed-industries/claude-agent-acp`)

- **Support:** the ACP agents page lists it as "Claude Agent (via Zed's SDK adapter)" [C2]. It is a third-party adapter, maintained by Zed, over the Agent SDK in §4.2. It is not an Anthropic product and not the Messages API "becoming ACP" (#537 conclusion 2).
- **Everything in §4.2 applies**, plus one more process layer and one more version to pin.
- **Benefit:** it would let Coach reuse its `@agentclientprotocol/sdk` client code. That is protocol symmetry, which #554 rules out as a reason.
- **Verdict:** **unnecessary.** If the Agent SDK is ever justified, call it directly instead of through a community wrapper.

### 4.4 Codex app-server

- **Support:** official, open source (`openai/codex`, `codex-rs/app-server`). OpenAI positions it for "a deep integration inside your own product: authentication, conversation history, approvals, and streamed agent events", and adds "If you are automating jobs or running Codex in CI, use the Codex SDK instead." [O1] The transport is JSON-RPC over stdio (WebSocket is "experimental and unsupported"). Some methods are gated behind `capabilities.experimentalApi` [O1].
- **Auth/BYOK:** `apiKey`, managed ChatGPT login, experimental external ChatGPT tokens, and Bedrock [O1]. The docs state: **"App-server authentication has never been permitted for commercial or hosted services."** [O1] Coach is a hosted web/iOS product, so ChatGPT-subscription auth is not available here (P3). The API-key mode still means spending against an OpenAI key.
- **Runtime:** a Rust `codex` binary per connection, with its own `config.toml` and sandbox policy (`approvalPolicy`, `sandbox`). Some commands, such as `thread/shellCommand`, run "outside the sandbox with full access." [O1]
- **Model discovery:** `model/list`, which returns models, reasoning efforts, `inputModalities`, and `isDefault` [O1].
- **Sessions/cancel:** `thread/start`/`resume`/`fork`, `turn/start`/`steer`/`interrupt`. Interrupted turns end with `status: "interrupted"` [O1].
- **Tools/MCP:** MCP servers are configured on the Codex side. A `required` server that fails to start fails `thread/start` [O1]. The private Whoop stdio bridge would plug in the same way it does for Cursor.
- **Streaming/usage:** item/turn notifications, plus `thread/tokenUsage/updated` [O1].
- **Coach mapping:** a third process registry, a third catalog authority, and a coding-agent sandbox whose defaults Coach would have to turn off one by one, all to reach GPT models that Cursor ACP already serves (P1).
- **Product benefit:** none named. Codex app-server is a coding-agent runtime, and Coach is not a coding agent (P6).
- **Verdict:** **unnecessary.**

### 4.5 OpenAI Responses API / Agents SDK (direct)

- **Support:** official. OpenAI frames the choice as the Responses API for "calling models directly or building an agent from scratch", the Agents SDK to "control the agent loop in your application", and a managed Agents API [O2]. It notes that "An Agents API session, an SDK session, a Responses conversation, and a sandbox are different resources." [O2]
- **Fit:** the Responses API is the OpenAI counterpart of §4.1. An in-process HTTP loop over Coach's own `TOOLS` would fit Coach's contracts more cleanly than any agent runtime. It needs no child process and no tenant filesystem.
- **Cost:** a second app-owned loop (tool-schema translation, streaming mapping, usage/caching accounting, retries, a catalog), plus a new provider setting, key storage, a picker group, and a new dependency.
- **Product benefit:** only P2 (direct OpenAI billing), which nobody has asked for.
- **Verdict:** **defer.** This is the right shape *if* P2 becomes real (see §6).

### 4.6 A generic ACP wrapper for Anthropic or OpenAI

- **Support:** ACP is "a shared standard for connecting coding tools with AI agents… between code editors/IDEs and coding agents" [C1]. The Codex entry on the ACP agents page is "Codex CLI (via ACP's adapter)", hosted at `agentclientprotocol/codex-acp` [C2]. That is an ACP-project adapter over the Codex CLI, not an OpenAI model API. Calling it "ChatGPT ACP" would be wrong.
- **Benefit:** a uniform transport inside Coach. The internal runner contract already provides that without forcing every provider through a coding-agent protocol (Decisions Log 2026-08-18, "native provider transports behind one runtime contract").
- **Verdict:** **unnecessary.** It should not become a mandatory abstraction.

## 5. Summary matrix

| Option | Official | Child process | Hosted-product auth | New dependency | Named Coach benefit | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Anthropic Messages SDK (current) | Yes | No | API key | No | Baseline | **Keep** |
| Claude Agent SDK | Yes | Yes, 1 per session | API key only, not claude.ai login | Yes plus native binary | None | Unnecessary |
| Claude ACP adapter | No (Zed) | Yes, 2 layers | Same as Agent SDK | Yes | Protocol symmetry only | Unnecessary |
| Codex app-server | Yes | Yes | API key, not ChatGPT login | Codex binary | None (GPT already via Cursor) | Unnecessary |
| OpenAI Responses / Agents SDK | Yes | No | API key | Yes (`openai`) | Only if direct OpenAI BYOK is requested | Defer |
| Generic ACP wrapper | Adapter-dependent | Yes | Varies | Yes | Protocol symmetry only | Unnecessary |

## 6. Decision

**Keep Anthropic on the direct Messages SDK loop. Add no second runtime and no
OpenAI/Codex provider.** Cursor ACP remains Coach's only agent-runtime
provider and the route to non-Anthropic models.

**Reopen this decision only when one of these triggers is met.** Record the
trigger in a new Decisions Log entry that supersedes this one.

1. **Direct OpenAI BYOK is requested** (P2), or Cursor stops serving the GPT models users rely on. Then add an OpenAI **Responses API** provider (§4.5) as an in-process loop. Do not use Codex app-server or ACP for this.
2. **Anthropic ships a model capability Coach needs that is only reachable through the Agent SDK** and not through the Messages API. Then re-evaluate §4.2 for that one capability, including the isolation checklist from [A3].
3. **Cursor ACP is retired or proves unfit** after the #550 soak and #553. Then choose a replacement against this document's matrix, not by symmetry.

The following are not triggers: a runtime being used by T3 Code, a new
protocol revision, or a new ACP adapter appearing in the registry.

## 7. Impact, migration cost, and rollback

- **SSE, persistence, work logs, presentation blocks:** unchanged. No new event types and no new `chat_logs.details` fields.
- **Model picker and Settings:** unchanged. No OpenAI/Codex group.
- **Production Node 20.20.2:** unchanged. No new binary, canary, or cgroup pressure.
- **Migration cost avoided:** each rejected runtime would cost a process registry (or a second loop), a catalog authority, tenant-isolation hardening, a deploy canary, and a fake-agent test suite. That is roughly the size of #537. All of it would recur on every vendor CLI/SDK upgrade.
- **Behavior that would have become provider-owned under §4.2/§4.4:** iteration cap, retry policy, first-turn recent-read prefetch, prompt-cache breakpoints, and transcript storage.
- **Rollback:** nothing to roll back. This is a docs-only decision, and superseding it is a Decisions Log edit.
- **Implementation tickets:** none filed, per #554 ("only if proceeding").

## 8. Sources (all accessed 2026-11-28)

- [A1] Anthropic, *Agent SDK overview*: https://code.claude.com/docs/en/agent-sdk/overview (redirected from `docs.anthropic.com/en/docs/agent-sdk/overview`)
- [A2] Anthropic, *Agent SDK TypeScript reference*: https://code.claude.com/docs/en/agent-sdk/typescript
- [A3] Anthropic, *Hosting the Agent SDK*: https://code.claude.com/docs/en/agent-sdk/hosting
- [O1] OpenAI, *Codex app-server*: https://learn.chatgpt.com/docs/app-server (redirected from `developers.openai.com/codex/app-server`)
- [O2] OpenAI, *Agents guide*: https://developers.openai.com/api/docs/guides/agents
- [C1] Agent Client Protocol, *Introduction*: https://agentclientprotocol.com/overview/introduction
- [C2] Agent Client Protocol, *Agents*: https://agentclientprotocol.com/get-started/agents
- [C3] Cursor, *CLI ACP*: https://cursor.com/docs/cli/acp (context for the existing Cursor path: `agent acp`, `CURSOR_API_KEY`, `session/load`)

Repository evidence: `apps/web/src/lib/coach/provider-runner.ts`,
`loop.ts`, `cursor-provider-adapter.ts`, `cursor-acp-runtime.ts`,
`persistence.ts`, `apps/web/src/app/api/chat/route.ts`,
`apps/web/package.json`, and `docs/decisions/DECISIONS.md` entries dated
2026-08-18, 2026-08-30, and 2026-11-04.
