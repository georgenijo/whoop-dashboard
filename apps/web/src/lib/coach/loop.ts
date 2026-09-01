import "server-only";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageCreateParamsBase,
  MessageParam,
  MessageStreamEvent,
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { getUserSettings, type ChatMessageInsert } from "@/lib/db";
import { BadApiKeyError, type ApiKeyOrigin } from "./api-key";
import { buildAnthropicConversation } from "./conversation";
import {
  anthropicReasoningConfig,
  parseCoachEffort,
} from "./provider";
import type {
  CoachConversationMessage,
  CoachUserTurn,
} from "./image-types";
import { COACH_MODEL, buildSystemPrompt } from "./prompts";
import {
  TOOLS,
  executeToolResult,
  newToolTurnState,
  type ToolDetail,
  type ToolProgressHandlers,
} from "./tools";

const CACHE_EPHEMERAL = { type: "ephemeral", ttl: "1h" } as const;

export const MAX_TOOL_ITERATIONS = 8;
export const MAX_OUTPUT_TOKENS = 16384;

export type Usage = {
  input_tokens_total: number;
  output_tokens_total: number;
  cache_creation_input_tokens_total: number;
  cache_read_input_tokens_total: number;
  calls: number;
};

export type DetailState = {
  iterations: number;
  effort?: string;
  persistence_ms?: number;
  cursor?: {
    transport?: "legacy" | "acp";
    acp?: {
      protocol_version: number | null;
      agent_name: string | null;
      agent_version: string | null;
      session_id: string | null;
      applied_parameters: Array<{ id: string; value: string }>;
      process: {
        exit_code: number | null;
        signal: NodeJS.Signals | null;
        cancelled: boolean;
        timed_out: boolean;
      };
    };
    requested_model: string;
    requested_parameters: Array<{ id: string; value: string }>;
    resolved_model: string | null;
    prompt_chars: number;
    prefetch: {
      attempted: boolean;
      loaded: boolean;
      duration_ms: number;
      tool_name:
        | "query_recovery"
        | "query_sleep"
        | "query_strain"
        | "query_workouts"
        | "query_daily_snapshot"
        | null;
      date_range: { start_date: string; end_date: string } | null;
      payload_chars: number;
      error: string | null;
    };
    event_counts: Record<string, number>;
    mcp_audit?: {
      status: "idle" | "healthy" | "fallback";
      exact_starts: number;
      exact_completions: number;
      error: string | null;
    };
    tool_events: Array<{
      name: string;
      phase: "started" | "completed";
      at_ms: number;
      duration_ms?: number;
      status?: "ok" | "error";
    }>;
    terminal_subtype: string | null;
    terminal_seen: boolean;
    // Counts every `started` tool_call event with a real MCP tool name — see
    // ./cursor-loop's `!a?.toolName` guard. May exceed the completed count
    // in `tool_events` when a call never finishes.
    attempted_tool_calls: number;
    timing: {
      prompt_build_ms: number;
      workspace_prep_ms: number;
      spawn_call_ms: number;
      spawn_to_system_init_ms: number | null;
      spawn_to_first_event_ms: number | null;
      spawn_to_first_assistant_text_ms: number | null;
      spawn_to_first_tool_event_ms: number | null;
      spawn_to_terminal_result_ms: number | null;
      cursor_duration_ms: number | null;
      cursor_api_duration_ms: number | null;
      spawn_to_process_close_ms: number | null;
      process_close_tail_ms: number | null;
      // Set only on an early-exit reject (stdio unavailable, a mid-stream
      // cap breach, or a child `error`) — kept separate from
      // spawn_to_process_close_ms, which scripts/BENCH.md reads as meaning
      // the process actually closed.
      spawn_to_early_exit_ms: number | null;
      cleanup_ms: number;
      turn_ms: number;
    };
  };
};

export type CoachStreamHandlers = ToolProgressHandlers & {
  onTextDelta?: (text: string) => void;
};

export type RunAnthropicOptions = CoachStreamHandlers & {
  signal?: AbortSignal;
};

function isRetriableApiError(err: unknown): boolean {
  if (!(err instanceof APIError)) return false;
  const status = err.status;
  if (status === 529) return true;
  if (typeof status === "number" && status >= 500 && status < 600) return true;
  return false;
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    (block as { type: unknown }).type === "tool_use" &&
    "id" in block &&
    "name" in block
  );
}

export function textFromContent(content: ContentBlock[]): string {
  return content
    .filter((block): block is TextBlock => {
      return (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      );
    })
    .map((block) => block.text)
    .join("")
    .trim();
}

// Sonnet 4.6 routinely ignores the system-prompt rule that says "open every
// turn with a text sentence before any tool_use" — especially when the user
// asks for an action like "sync" or "check". When that happens the UI sits on
// "Thinking..." for the full model-thinking window and the user has no idea
// what's about to happen. Synthesize a short preamble so the assistant bubble
// always has visible text before tools fire. Not persisted into chat_messages
// (the model didn't actually say it); purely a transient UI hint streamed via
// SSE.
export function synthesizePreamble(toolUses: ToolUseBlock[]): string {
  const names = new Set(toolUses.map((t) => t.name));
  if (names.has("trigger_whoop_sync")) {
    return names.size > 1 ? "Trying a fresh sync and pulling your data." : "Trying a fresh sync.";
  }
  if (names.size > 1) return "Pulling your data.";
  const only = toolUses[0]?.name;
  switch (only) {
    case "query_recovery":
      return "Pulling your recovery data.";
    case "query_sleep":
      return "Checking your sleep.";
    case "query_strain":
      return "Pulling your strain.";
    case "query_workouts":
      return "Looking at your workouts.";
    case "query_naps":
      return "Checking your naps.";
    case "query_steps":
      return "Pulling your step counts.";
    case "query_journal":
      return "Checking your journal entries.";
    case "query_daily_snapshot":
      return "Pulling your data.";
    default:
      return "Looking into that.";
  }
}

function withCacheBreakpoint(messages: MessageParam[]): MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  if (typeof last.content === "string") {
    out[out.length - 1] = {
      ...last,
      content: [
        { type: "text", text: last.content, cache_control: CACHE_EPHEMERAL },
      ],
    };
    return out;
  }
  if (!Array.isArray(last.content) || last.content.length === 0) return out;
  const blocks = last.content.slice() as ContentBlockParam[];
  const tail = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = {
    ...tail,
    cache_control: CACHE_EPHEMERAL,
  } as ContentBlockParam;
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

function addUsageTotals(
  usage: Usage,
  responseUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }
): void {
  usage.input_tokens_total += responseUsage.input_tokens;
  usage.output_tokens_total += responseUsage.output_tokens;
  usage.cache_creation_input_tokens_total +=
    responseUsage.cache_creation_input_tokens ?? 0;
  usage.cache_read_input_tokens_total +=
    responseUsage.cache_read_input_tokens ?? 0;
  usage.calls += 1;
}

function emitStreamProgress(
  event: MessageStreamEvent,
  handlers?: CoachStreamHandlers
): void {
  if (event.type !== "content_block_delta") return;

  switch (event.delta.type) {
    case "text_delta":
      handlers?.onTextDelta?.(event.delta.text);
      break;
    case "thinking_delta":
    case "signature_delta":
    case "input_json_delta":
    case "citations_delta":
      break;
  }
}

async function streamMessage(
  client: Anthropic,
  params: MessageCreateParamsBase,
  threadId: number,
  usage: Usage,
  options: RunAnthropicOptions
): Promise<Message> {
  const stream = client.messages.stream(params, {
    signal: options.signal,
    headers: { "anthropic-beta": "extended-cache-ttl-2025-04-11" },
  });
  for await (const event of stream) {
    emitStreamProgress(event, options);
  }

  const response = await stream.finalMessage();
  addUsageTotals(usage, response.usage);
  console.info("[coach] model_response", {
    thread_id: threadId,
    stop_reason: response.stop_reason,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  });
  return response;
}

export async function runAnthropicSdk(
  userId: number,
  threadId: number,
  turn: CoachUserTurn,
  history: CoachConversationMessage[],
  toolDetails: ToolDetail[],
  usage: Usage,
  detailState: DetailState,
  apiKey: string,
  apiKeyOrigin: ApiKeyOrigin,
  options: RunAnthropicOptions = {},
  accumulator?: ChatMessageInsert[]
): Promise<{ reply: string; iterations: number; messages: ChatMessageInsert[] }> {
  // Per-turn state shared across all `executeToolResult` calls in this turn.
  // Currently used to hard-cap `trigger_whoop_sync` at one attempt per turn.
  const turnState = newToolTurnState();

  const client = new Anthropic({
    apiKey,
    defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" },
  });

  // Wrap an Anthropic SDK call and translate a 401 into our BadApiKeyError
  // (carrying origin) so the chat route can render a "your key was
  // rejected" banner instead of a generic 500.
  //
  // Retries once on transient upstream failures (Anthropic 529 "overloaded"
  // and 5xx server errors). Anthropic overload bursts are short-lived; one
  // retry covers the common case without compounding latency on a real
  // outage. Retry is suppressed if the stream already emitted text (so the
  // user does not see a double reply) or if the caller aborted.
  async function callModel(params: MessageCreateParamsBase, callOptions: RunAnthropicOptions): Promise<Message> {
    let emittedText = false;
    const wrappedOptions: RunAnthropicOptions = {
      ...callOptions,
      onTextDelta: (text) => {
        emittedText = true;
        callOptions.onTextDelta?.(text);
      },
    };
    try {
      return await streamMessage(client, params, threadId, usage, wrappedOptions);
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        throw new BadApiKeyError(apiKeyOrigin);
      }
      if (!emittedText && !callOptions.signal?.aborted && isRetriableApiError(err)) {
        const status = (err as APIError).status;
        const delayMs = 500 + Math.floor(Math.random() * 1000);
        console.warn("[coach] retrying after transient upstream error", {
          thread_id: threadId,
          status,
          delay_ms: delayMs,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        if (callOptions.signal?.aborted) throw err;
        try {
          return await streamMessage(client, params, threadId, usage, wrappedOptions);
        } catch (retryErr) {
          if (retryErr instanceof APIError && retryErr.status === 401) {
            throw new BadApiKeyError(apiKeyOrigin);
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }
  // Phase E.1 — surface the user's stated goals into the system prompt as a
  // third (uncached) block. Null/empty → byte-identical to the pre-Phase-E.1
  // two-block prompt, preserving the cache hit.
  //
  // Issue #498 — the per-user "Instructions" from Settings ride along as a
  // further uncached block, additive to DEFAULT_SYSTEM_PROMPT rather than a
  // replacement for it.
  const userSettings = getUserSettings(userId);
  const coachEffort = parseCoachEffort(userSettings?.coach_effort);
  detailState.effort = coachEffort;
  const systemPrompt = buildSystemPrompt(
    new Date(),
    userSettings?.coach_goals ?? null,
    userSettings?.system_prompt ?? null,
  );
  const messagesToPersist: ChatMessageInsert[] = accumulator ?? [];
  messagesToPersist.push({
    role: "user",
    content: turn.displayText,
    blocks: turn.displayText
      ? [{ type: "text", text: turn.displayText }]
      : [],
    attachments: turn.images,
  });
  const conversation: MessageParam[] = buildAnthropicConversation(history, turn);

  const pendingAssistant: ChatMessageInsert = {
    role: "assistant",
    content: "",
    blocks: [],
  };
  messagesToPersist.push(pendingAssistant);
  const optionsForFirstTurn: RunAnthropicOptions = {
    ...options,
    onTextDelta: (text) => {
      pendingAssistant.content = `${pendingAssistant.content}${text}`;
      options.onTextDelta?.(text);
    },
  };

  let response = await callModel({
    model: COACH_MODEL,
    ...anthropicReasoningConfig(coachEffort),
    tools: TOOLS,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: withCacheBreakpoint(conversation),
  }, optionsForFirstTurn);

  let assistantText = textFromContent(response.content);
  pendingAssistant.content = assistantText;
  pendingAssistant.blocks = response.content;
  conversation.push({
    role: "assistant",
    content: response.content as ContentBlockParam[],
  });

  let iterations = 0;
  detailState.iterations = iterations;
  while (response.stop_reason === "tool_use") {
    if (iterations >= MAX_TOOL_ITERATIONS) {
      throw new Error(`Tool-use iteration limit exceeded (${MAX_TOOL_ITERATIONS})`);
    }
    iterations += 1;
    detailState.iterations = iterations;

    const toolUses = response.content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      throw new Error("Claude stopped for tool_use without requesting a tool");
    }

    // If the model emitted no preceding text, inject a synthetic preamble so
    // the assistant bubble has visible text before the spinner fires. See
    // synthesizePreamble for why. Skip if the model already wrote something.
    if (!assistantText && options.onTextDelta) {
      options.onTextDelta(synthesizePreamble(toolUses) + "\n\n");
    }

    // If the model emits trigger_whoop_sync alongside query_* in the same
    // batch, the queries would race the sync — re-querying before fresh
    // rows land. Partition: ALL trigger_whoop_sync blocks run serially
    // FIRST (the per-turn cap will short-circuit duplicates after the
    // first), then ALL other blocks run in parallel. Original positional
    // order preserved so tool_use ↔ tool_result alignment holds.
    const toolResults: Awaited<ReturnType<typeof executeToolResult>>[] = new Array(
      toolUses.length
    );
    const indexed = toolUses.map((toolUse, i) => ({ toolUse, i }));
    const serial = indexed.filter(({ toolUse }) => toolUse.name === "trigger_whoop_sync");
    const parallel = indexed.filter(({ toolUse }) => toolUse.name !== "trigger_whoop_sync");

    for (const { toolUse, i } of serial) {
      toolResults[i] = await executeToolResult(threadId, toolUse, toolDetails, {
        userId,
        progress: options,
        signal: options.signal,
        turnState,
      });
    }
    const parallelResults = await Promise.all(
      parallel.map(({ toolUse }) =>
        executeToolResult(threadId, toolUse, toolDetails, {
          userId,
          progress: options,
          signal: options.signal,
          turnState,
        })
      )
    );
    parallel.forEach(({ i }, idx) => {
      toolResults[i] = parallelResults[idx];
    });
    messagesToPersist.push({
      role: "user",
      content: "[tool_result]",
      blocks: toolResults,
    });
    conversation.push({
      role: "user",
      content: toolResults,
    });

    const pendingTurnAssistant: ChatMessageInsert = {
      role: "assistant",
      content: "",
      blocks: [],
    };
    messagesToPersist.push(pendingTurnAssistant);
    const optionsForTurn: RunAnthropicOptions = {
      ...options,
      onTextDelta: (text) => {
        pendingTurnAssistant.content = `${pendingTurnAssistant.content}${text}`;
        options.onTextDelta?.(text);
      },
    };

    response = await callModel({
      model: COACH_MODEL,
      ...anthropicReasoningConfig(coachEffort),
      tools: TOOLS,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: withCacheBreakpoint(conversation),
    }, optionsForTurn);

    assistantText = textFromContent(response.content);
    pendingTurnAssistant.content = assistantText;
    pendingTurnAssistant.blocks = response.content;
    conversation.push({
      role: "assistant",
      content: response.content as ContentBlockParam[],
    });
  }

  if (response.stop_reason === "max_tokens") {
    const partial = textFromContent(response.content);
    const suffix = partial
      ? "\n\n_[response truncated — hit max_tokens cap]_"
      : "_[response truncated before any text was generated — hit max_tokens cap]_";
    const reply = `${partial}${suffix}`;
    const finalMessage = messagesToPersist[messagesToPersist.length - 1];
    if (finalMessage?.role === "assistant") {
      messagesToPersist[messagesToPersist.length - 1] = {
        ...finalMessage,
        content: reply,
      };
    }
    return { reply, iterations, messages: messagesToPersist };
  }

  if (response.stop_reason !== "end_turn") {
    throw new Error(`Claude stopped before finishing: ${response.stop_reason}`);
  }

  return { reply: assistantText, iterations, messages: messagesToPersist };
}
