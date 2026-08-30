import "server-only";

import type {
  SessionNotification,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type {
  CoachMcpAuditEndEvent,
  CoachMcpAuditEvent,
  CoachMcpAuditStartEvent,
} from "@/coach-mcp/audit-events";
import type { ChatMessageInsert } from "@/lib/db";
import { createHash } from "node:crypto";
import {
  buildCursorPrompt,
  countCursorRows,
  cursorSystemPromptForUser,
  CursorVisibleTextAccumulator,
  preloadRecentContext,
  selectRecentPrefetchTool,
  type RunCursorTurnArgs,
  type RunCursorTurnResult,
} from "./cursor-loop";
import { selectActiveImageContext } from "./conversation";
import { captureToolResponse, redactToolPayload } from "./tools";
import { resolveCursorKey } from "./cursor-key";
import {
  cursorAcpSessions,
  cursorCredentialFingerprint,
  cursorPromptFingerprint,
} from "./cursor-acp-registry";
import { canonicalCoachToolName } from "./cursor-acp-runtime";
import { CursorAgentError } from "./cursor-errors";

const MAX_CURSOR_TOOL_CALLS = 12;
const MAX_CURSOR_HISTORY_ROWS = 30;

type AcpToolState = {
  id: string;
  name: string | null;
  title: string;
  input: unknown;
  output: unknown;
  status: "pending" | "in_progress" | "completed" | "failed";
  startedAt: number;
  startedEmitted: boolean;
  completedEmitted: boolean;
  historyIndex: number;
};

const GENERIC_CURSOR_MCP_TOOL_NAME = "whoop_tool";

function trackedToolName(state: AcpToolState): {
  name: string;
  canonical: boolean;
} | null {
  const canonical =
    canonicalCoachToolName(state.name) ??
    canonicalCoachToolName(state.title);
  if (canonical) return { name: canonical, canonical: true };

  // Cursor Agent 2026.08 currently redacts MCP call metadata from ACP
  // notifications. Calls from the only configured MCP server arrive as the
  // literal title `MCP: tool`, empty input, and `{ success: true }` output.
  // Track that shape so live activity, audit counts, and the tool-call cap do
  // not silently disappear. Do not persist a fabricated tool_use block into
  // conversation history because Cursor did not disclose the real tool name.
  if (state.title.trim().toLowerCase() === "mcp: tool") {
    return { name: GENERIC_CURSOR_MCP_TOOL_NAME, canonical: false };
  }
  return null;
}

function mergeToolState(
  previous: AcpToolState | undefined,
  update: ToolCall | ToolCallUpdate,
): AcpToolState {
  return {
    id: update.toolCallId,
    name: update.name ?? previous?.name ?? null,
    title: update.title ?? previous?.title ?? update.name ?? "Tool call",
    input: update.rawInput ?? previous?.input ?? {},
    output:
      update.rawOutput ?? previous?.output ?? toolContentOutput(update.content),
    status: update.status ?? previous?.status ?? "pending",
    startedAt: previous?.startedAt ?? Date.now(),
    startedEmitted: previous?.startedEmitted ?? false,
    completedEmitted: previous?.completedEmitted ?? false,
    historyIndex: previous?.historyIndex ?? 0,
  };
}

function toolContentOutput(
  content: ToolCall["content"] | ToolCallUpdate["content"],
): unknown {
  if (!content) return null;
  const text = content
    .flatMap((item) => {
      if (item.type === "content" && item.content.type === "text") {
        return [item.content.text];
      }
      return [];
    })
    .join("\n");
  return text || content;
}

function unwrapToolOutput(output: unknown): {
  value: unknown;
  isError: boolean;
} {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as {
      isError?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    };
    const text = record.content?.find(
      (item) => item.type === "text" && typeof item.text === "string",
    )?.text;
    if (typeof text === "string") {
      try {
        return { value: JSON.parse(text), isError: record.isError === true };
      } catch {
        return { value: text, isError: record.isError === true };
      }
    }
    return { value: output, isError: record.isError === true };
  }
  if (typeof output === "string") {
    try {
      return { value: JSON.parse(output), isError: false };
    } catch {
      return { value: output, isError: false };
    }
  }
  return { value: output, isError: false };
}

function toolResultContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function conversationFingerprint(
  conversation: Array<{
    role: "user" | "assistant";
    contentBlocks: unknown[];
    images: Array<{ id: string; sha256: string }>;
  }>,
): string {
  const window = conversation.slice(-MAX_CURSOR_HISTORY_ROWS);
  while (
    window[0]?.role === "user" &&
    window[0].contentBlocks.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type?: unknown }).type === "tool_result",
    )
  ) {
    window.shift();
  }
  const normalized = window.map((message) => ({
    role: message.role,
    contentBlocks: message.contentBlocks,
    images: message.images.map((image) => ({
      id: image.id,
      sha256: image.sha256,
    })),
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function expectedConversationFingerprint(
  conversation: RunCursorTurnArgs["conversation"],
  messages: ChatMessageInsert[],
): string {
  return conversationFingerprint([
    ...conversation,
    ...messages.map((message) => ({
      role: message.role,
      contentBlocks: Array.isArray(message.blocks)
        ? message.blocks
        : message.content
          ? [{ type: "text", text: message.content }]
          : [],
      images: message.attachments ?? [],
    })),
  ]);
}

export async function runCursorAcpTurn(
  args: RunCursorTurnArgs,
): Promise<RunCursorTurnResult> {
  args.options.signal?.throwIfAborted();
  const turnStartedAt = Date.now();
  const {
    userId,
    threadId,
    model,
    modelParameters = [],
    turn,
    conversation,
    toolDetails,
    usage,
    detailState,
    options,
  } = args;
  const messages: ChatMessageInsert[] = args.accumulator ?? [];
  messages.push({
    role: "user",
    content: turn.displayText,
    blocks: turn.displayText ? [{ type: "text", text: turn.displayText }] : [],
    attachments: turn.images,
  });

  const selectedPrefetchTool = selectRecentPrefetchTool(turn.modelText);
  const prefetchCallId = `prefetch:${selectedPrefetchTool ?? "none"}:${turnStartedAt}`;
  const prefetchInput = { intent: "recent_context" };
  if (selectedPrefetchTool) {
    options.onToolUseStart?.({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      input: prefetchInput,
    });
  }
  const prefetchStartedAt = Date.now();
  let preloadedContext = null;
  let prefetchError: string | null = null;
  try {
    preloadedContext = await preloadRecentContext(userId, turn.modelText);
  } catch (error) {
    prefetchError = error instanceof Error ? error.message : String(error);
  }
  const prefetchMs = Date.now() - prefetchStartedAt;
  if (selectedPrefetchTool) {
    const rows = preloadedContext
      ? countCursorRows(preloadedContext.data)
      : null;
    const response = prefetchError
      ? { error: prefetchError }
      : captureToolResponse(preloadedContext?.data);
    toolDetails.push({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      input: prefetchInput,
      duration_ms: prefetchMs,
      rows,
      status: prefetchError ? "error" : "ok",
      ...(prefetchError ? { error: prefetchError } : {}),
      response,
    });
    options.onToolUseEnd?.({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      duration_ms: prefetchMs,
      rows,
      status: prefetchError ? "error" : "ok",
      ...(prefetchError ? { error: prefetchError } : {}),
      response,
    });
  }

  const { key, origin: keyOrigin } = resolveCursorKey(userId);
  const systemPrompt = cursorSystemPromptForUser(userId);
  const credentialFingerprint = cursorCredentialFingerprint(key);
  const promptFingerprint = cursorPromptFingerprint(systemPrompt);
  const imageContext = selectActiveImageContext(conversation, turn);
  const historyFingerprint = conversationFingerprint(conversation);
  const visibleText = new CursorVisibleTextAccumulator();
  let pendingAssistant: ChatMessageInsert | null = null;
  const tools = new Map<string, AcpToolState>();
  let completedToolCalls = 0;
  let providerFallbackStarts = 0;
  let exactAuditStarts = 0;
  let exactAuditCompletions = 0;
  let auditError: string | null = null;
  const eventCounts: Record<string, number> = {};
  const toolEvents: Array<{
    name: string;
    phase: "started" | "completed";
    at_ms: number;
    duration_ms?: number;
    status?: "ok" | "error";
  }> = [];
  const cursorDetail: NonNullable<RunCursorTurnArgs["detailState"]["cursor"]> =
    {
      requested_model: model,
      requested_parameters: modelParameters,
      resolved_model: null,
      prompt_chars: 0,
      prefetch: {
        attempted: selectedPrefetchTool !== null,
        loaded: preloadedContext !== null,
        duration_ms: prefetchMs,
        tool_name: preloadedContext?.toolName ?? selectedPrefetchTool,
        date_range: preloadedContext?.dateRange ?? null,
        payload_chars: preloadedContext
          ? JSON.stringify(preloadedContext.data).length
          : 0,
        error: prefetchError,
      },
      event_counts: eventCounts,
      mcp_audit: {
        status: "idle",
        exact_starts: 0,
        exact_completions: 0,
        error: null,
      },
      tool_events: toolEvents,
      terminal_subtype: null,
      terminal_seen: false,
      attempted_tool_calls: 0,
      timing: {
        prompt_build_ms: 0,
        workspace_prep_ms: 0,
        spawn_call_ms: 0,
        spawn_to_system_init_ms: null,
        spawn_to_first_event_ms: null,
        spawn_to_first_assistant_text_ms: null,
        spawn_to_first_tool_event_ms: null,
        spawn_to_terminal_result_ms: null,
        cursor_duration_ms: null,
        cursor_api_duration_ms: null,
        spawn_to_process_close_ms: null,
        process_close_tail_ms: null,
        spawn_to_early_exit_ms: null,
        cleanup_ms: 0,
        turn_ms: 0,
      },
      transport: "acp",
      acp: {
        protocol_version: null,
        agent_name: null,
        agent_version: null,
        session_id: null,
        applied_parameters: [],
        process: {
          exit_code: null,
          signal: null,
          cancelled: false,
          timed_out: false,
        },
      },
    };
  detailState.cursor = cursorDetail;

  const result = await cursorAcpSessions.run(
    {
      userId,
      threadId,
      key,
      keyOrigin,
      credentialFingerprint,
      promptFingerprint,
      withMcp: true,
      historyFingerprint,
    },
    async (runtime) => {
      try {
        const workspaceStartedAt = Date.now();
        const turnEpoch = await runtime.prepareTurn(imageContext.images);
        cursorDetail.timing.workspace_prep_ms = Date.now() - workspaceStartedAt;
        await runtime.applyModel(model, modelParameters);
        const promptStartedAt = Date.now();
        const prompt = buildCursorPrompt(
          userId,
          turn,
          runtime.hasPrompted ? [] : conversation,
          imageContext.activeIds,
          preloadedContext,
          !runtime.hasPrompted,
          systemPrompt,
        );
        cursorDetail.timing.prompt_build_ms = Date.now() - promptStartedAt;
        cursorDetail.prompt_chars = prompt.length;
        let toolCapError: CursorAgentError | null = null;
        const exactTools = new Map<string, CoachMcpAuditStartEvent>();
        let fallbackHistoryOffset = 0;

        const enforceToolCap = (attempted: number) => {
          if (attempted <= MAX_CURSOR_TOOL_CALLS || toolCapError) return;
          toolCapError = new CursorAgentError(
            "agent",
            `Cursor turn exceeded ${MAX_CURSOR_TOOL_CALLS} tool calls`,
          );
          void runtime.cancelActiveTurn(toolCapError);
        };

        const emitToolStart = (id: string, name: string, input: unknown) => {
          toolEvents.push({
            name,
            phase: "started",
            at_ms: Date.now() - turnStartedAt,
          });
          if (name === "view_chat_image") {
            options.onToolProgress?.({
              id,
              tool: name,
              stage: "reviewing",
              message: "Reviewing image…",
            });
          }
          options.onToolUseStart?.({ id, name, input });
        };

        const appendToolHistory = (
          id: string,
          name: string,
          input: unknown,
          resultText: string,
          isError: boolean,
          insertAt?: number,
        ) => {
          if (
            name === "view_chat_image" ||
            name === GENERIC_CURSOR_MCP_TOOL_NAME
          ) {
            return;
          }
          const historyMessages: ChatMessageInsert[] = [
            {
              role: "assistant",
              content: "",
              blocks: [{ type: "tool_use", id, name, input: input ?? {} }],
            },
            {
              role: "user",
              content: "[tool_result]",
              blocks: [
                {
                  type: "tool_result",
                  tool_use_id: id,
                  content: resultText,
                  ...(isError ? { is_error: true } : {}),
                },
              ],
            },
          ];
          if (insertAt === undefined) {
            messages.push(...historyMessages);
          } else {
            messages.splice(insertAt, 0, ...historyMessages);
          }
        };

        const finishFallbackTool = (state: AcpToolState) => {
          if (state.completedEmitted) return;
          const tracked = trackedToolName(state);
          if (!tracked) return;
          const { name } = tracked;
          state.completedEmitted = true;
          completedToolCalls += 1;
          const durationMs = Math.max(0, Date.now() - state.startedAt);
          const unwrapped = unwrapToolOutput(state.output);
          const isError = state.status === "failed" || unwrapped.isError;
          const rows = isError ? null : countCursorRows(unwrapped.value);
          const resultText = toolResultContent(unwrapped.value);
          toolEvents.push({
            name,
            phase: "completed",
            at_ms: Date.now() - turnStartedAt,
            duration_ms: durationMs,
            status: isError ? "error" : "ok",
          });
          toolDetails.push({
            id: state.id,
            name,
            input: state.input,
            duration_ms: durationMs,
            rows,
            status: isError ? "error" : "ok",
            ...(isError ? { error: resultText.slice(0, 200) } : {}),
            response: unwrapped.value,
          });
          options.onToolUseEnd?.({
            id: state.id,
            name,
            duration_ms: durationMs,
            rows,
            status: isError ? "error" : "ok",
            ...(isError ? { error: resultText.slice(0, 200) } : {}),
            response: captureToolResponse(unwrapped.value),
          });
          if (tracked.canonical) {
            appendToolHistory(
              state.id,
              name,
              state.input,
              resultText,
              isError,
              state.historyIndex + fallbackHistoryOffset,
            );
            fallbackHistoryOffset += 2;
          }
        };

        const updateTool = (update: ToolCall | ToolCallUpdate) => {
          const previous = tools.get(update.toolCallId);
          const state = mergeToolState(previous, update);
          if (!previous) state.historyIndex = messages.length;
          tools.set(state.id, state);
          const tracked = trackedToolName(state);
          if (tracked && !state.startedEmitted) {
            state.startedEmitted = true;
            visibleText.toolBoundary();
            pendingAssistant = null;
            providerFallbackStarts += 1;
            enforceToolCap(providerFallbackStarts);
          }
        };

        const finishExactTool = (
          start: CoachMcpAuditStartEvent,
          end: CoachMcpAuditEndEvent,
        ) => {
          exactAuditCompletions += 1;
          completedToolCalls += 1;
          toolEvents.push({
            name: start.tool_name,
            phase: "completed",
            at_ms: Date.now() - turnStartedAt,
            duration_ms: end.duration_ms,
            status: end.status,
          });
          toolDetails.push({
            id: start.call_id,
            name: start.tool_name,
            input: start.input,
            duration_ms: end.duration_ms,
            rows: end.rows,
            status: end.status,
            ...(end.error ? { error: end.error } : {}),
            ...(end.response === undefined ? {} : { response: end.response }),
          });
          options.onToolUseEnd?.({
            id: start.call_id,
            name: start.tool_name,
            duration_ms: end.duration_ms,
            rows: end.rows,
            status: end.status,
            ...(end.error ? { error: end.error } : {}),
            ...(end.response === undefined ? {} : { response: end.response }),
          });
        };

        const handleAuditEvent = (event: CoachMcpAuditEvent) => {
          eventCounts[`mcp_audit_${event.phase}`] =
            (eventCounts[`mcp_audit_${event.phase}`] ?? 0) + 1;
          if (event.phase === "start") {
            exactAuditStarts += 1;
            exactTools.set(event.call_id, event);
            enforceToolCap(exactAuditStarts);
            emitToolStart(event.call_id, event.tool_name, event.input);
            return;
          }
          const start = exactTools.get(event.call_id);
          if (!start) {
            auditError ??= "Coach MCP audit completion had no matching start";
            return;
          }
          exactTools.delete(event.call_id);
          finishExactTool(start, event);
        };

        const auditListener = runtime.listenForMcpAudit(
          turnEpoch,
          handleAuditEvent,
          (error) => {
            auditError ??= error.message.slice(0, 500);
          },
        );

        let response: Awaited<ReturnType<typeof runtime.prompt>>;
        try {
          response = await runtime.prompt(
            prompt,
            options.signal,
            (notification: SessionNotification) => {
              const update = notification.update;
              eventCounts[update.sessionUpdate] =
                (eventCounts[update.sessionUpdate] ?? 0) + 1;
              switch (update.sessionUpdate) {
                case "agent_message_chunk":
                  if (update.content.type === "text") {
                    const delta = visibleText.append(update.content.text);
                    if (delta) {
                      if (!pendingAssistant) {
                        pendingAssistant = {
                          role: "assistant",
                          content: "",
                          blocks: [],
                        };
                        messages.push(pendingAssistant);
                      }
                      pendingAssistant.content = `${pendingAssistant.content}${delta}`;
                      pendingAssistant.blocks = [
                        { type: "text", text: pendingAssistant.content },
                      ];
                      options.onTextDelta?.(delta);
                    }
                  }
                  break;
                case "agent_thought_chunk":
                  visibleText.segmentBoundary();
                  break;
                case "tool_call":
                case "tool_call_update":
                  updateTool(update);
                  break;
                default:
                  break;
              }
            },
          );
        } catch (error) {
          if (toolCapError) throw toolCapError;
          throw error;
        } finally {
          await auditListener.drainAndStop();
        }
        if (exactAuditStarts === 0) {
          if (providerFallbackStarts > 0) {
            auditError ??= "No exact Coach MCP audit events were received";
          }
          for (const state of [...tools.values()]) {
            const tracked = trackedToolName(state);
            if (!tracked) continue;
            emitToolStart(
              state.id,
              tracked.name,
              redactToolPayload(state.input),
            );
            if (state.status !== "completed" && state.status !== "failed") {
              state.status = "failed";
            }
            finishFallbackTool(state);
          }
        } else {
          for (const start of exactTools.values()) {
            finishExactTool(start, {
              ...start,
              phase: "end",
              at_ms: Date.now(),
              duration_ms: Math.max(0, Date.now() - start.at_ms),
              rows: null,
              status: "error",
              error: "Tool audit ended before completion",
              response: { error: "Tool audit ended before completion" },
            });
          }
          exactTools.clear();
        }
        cursorDetail.mcp_audit = {
          status:
            exactAuditStarts > 0 && !auditError
              ? "healthy"
              : providerFallbackStarts > 0 || auditError
                ? "fallback"
                : "idle",
          exact_starts: exactAuditStarts,
          exact_completions: exactAuditCompletions,
          error: auditError,
        };
        const usageDelta = runtime.usageDelta(response.usage);
        if (usageDelta) {
          usage.input_tokens_total += usageDelta.inputTokens;
          usage.output_tokens_total += usageDelta.outputTokens;
          usage.cache_read_input_tokens_total +=
            usageDelta.cachedReadTokens ?? 0;
          usage.cache_creation_input_tokens_total +=
            usageDelta.cachedWriteTokens ?? 0;
          usage.calls += 1;
        }
        if (toolCapError) throw toolCapError;
        const reply = visibleText.value().trim();
        if (response.stopReason !== "refusal") {
          if (pendingAssistant) {
            pendingAssistant.content = reply;
            pendingAssistant.blocks = [{ type: "text", text: reply }];
          } else {
            messages.push({
              role: "assistant",
              content: reply,
              blocks: [{ type: "text", text: reply }],
            });
          }
          runtime.historyFingerprint = expectedConversationFingerprint(
            conversation,
            messages,
          );
        }
        return { runtime, response, promptChars: prompt.length, reply };
      } finally {
        cursorDetail.resolved_model = runtime.diagnostics.resolvedModel;
        cursorDetail.timing.spawn_call_ms = runtime.diagnostics.timing.spawnMs;
        cursorDetail.timing.spawn_to_system_init_ms =
          runtime.diagnostics.timing.initializeMs;
        cursorDetail.timing.spawn_to_first_event_ms =
          runtime.diagnostics.timing.firstEventMs;
        cursorDetail.timing.spawn_to_terminal_result_ms =
          runtime.diagnostics.timing.promptMs;
        cursorDetail.timing.cursor_duration_ms =
          runtime.diagnostics.timing.promptMs;
        cursorDetail.acp = {
          protocol_version: runtime.diagnostics.protocolVersion,
          agent_name: runtime.diagnostics.agentName,
          agent_version: runtime.diagnostics.agentVersion,
          session_id: runtime.diagnostics.sessionId,
          applied_parameters: runtime.diagnostics.appliedParameters,
          process: {
            exit_code: runtime.diagnostics.process.exitCode,
            signal: runtime.diagnostics.process.signal,
            cancelled: runtime.diagnostics.process.cancelled,
            timed_out: runtime.diagnostics.process.timedOut,
          },
        };
      }
    },
  );

  if (result.response.stopReason === "refusal") {
    throw new Error("Cursor refused the request");
  }
  const reply = result.reply;
  detailState.effort = modelParameters.find((parameter) =>
    /reason|effort|thinking|thought/i.test(parameter.id),
  )?.value;
  detailState.iterations = completedToolCalls + 1;
  cursorDetail.terminal_subtype = result.response.stopReason;
  cursorDetail.terminal_seen = true;
  cursorDetail.attempted_tool_calls = toolEvents.filter(
    (event) => event.phase === "started",
  ).length;
  cursorDetail.timing.turn_ms = Date.now() - turnStartedAt;
  return {
    reply,
    iterations: completedToolCalls + 1,
    messages,
  };
}
