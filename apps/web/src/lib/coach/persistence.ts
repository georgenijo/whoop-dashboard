import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AuthSource } from "@/lib/auth";
import {
  addChatLog,
  addChatMessages,
  setChatThreadTitle,
  type ChatMessageInsert,
} from "@/lib/db";
import type { ApiKeyOrigin } from "./api-key";
import { resolveCatalogModel } from "./model-resolution";
import {
  type DetailState,
  type RunAnthropicOptions,
  type Usage,
  textFromContent,
} from "./loop";
import { titleModel } from "./model-defaults";
import { TITLE_SYSTEM_PROMPT } from "./prompts";
import { anthropicReasoningConfig } from "./provider";
import { deriveTitleFromText } from "./title";
import { type ToolDetail, chatLogToolSummaries } from "./tools";
import { resolveCoachProvider } from "./provider";
import { runCoachProviderTurn } from "./provider-runner";
import { CoachWorkLogCollector } from "./work-log";
import type { CoachWorkLog } from "./work-log-types";
import {
  acquireGenerationLock, classifyGenerationError, clearGenerationFailure,
  GENERATION_CLIENT_OPTIONS, GENERATION_DEADLINE_MS, recordGenerationFailure,
} from "@/lib/ai-generation";
import { releaseSettingLock } from "@/lib/db/settings";
import type {
  CoachConversationMessage,
  CoachUserTurn,
} from "./image-types";
import {
  CoachPresentationStreamFilter,
  extractCoachPresentation,
  type CoachPresentationBlock,
} from "./presentation";

export type CoachTurnHandle = {
  readonly accumulator: ChatMessageInsert[];
  markCommitted: () => void;
  flushAborted: () => void;
};

export function createCoachTurnHandle(threadId: number): CoachTurnHandle {
  const accumulator: ChatMessageInsert[] = [];
  let flushed = false;
  return {
    accumulator,
    markCommitted: () => {
      flushed = true;
    },
    flushAborted: () => {
      if (flushed) return;
      flushed = true;
      if (accumulator.length === 0) return;
      addChatMessages(threadId, accumulator, "aborted");
    },
  };
}

export async function runAndPersistCoachTurn(
  userId: number,
  thread: { id: number },
  turn: CoachUserTurn,
  conversation: CoachConversationMessage[],
  days: number | null,
  source: AuthSource,
  apiKey: string,
  apiKeyOrigin: ApiKeyOrigin,
  options: RunAnthropicOptions = {},
  handle?: CoachTurnHandle
): Promise<{ reply: string; workLog: CoachWorkLog; presentationBlocks: CoachPresentationBlock[] }> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const promptPreview = turn.displayText
    ? turn.displayText.slice(0, 200)
    : `[image message: ${turn.images.length} attachments]`;
  const toolDetails: ToolDetail[] = [];
  const usage: Usage = {
    input_tokens_total: 0,
    output_tokens_total: 0,
    cache_creation_input_tokens_total: 0,
    cache_read_input_tokens_total: 0,
    calls: 0,
  };
  const detailState: DetailState = { iterations: 0 };
  const accumulator = handle?.accumulator;
  const selection = resolveCoachProvider(userId);
  const workLogCollector = new CoachWorkLogCollector();
  const presentationStream = new CoachPresentationStreamFilter();
  const clientTextDelta = options.onTextDelta;
  const providerOptions = workLogCollector.wrap({
    ...options,
    onTextDelta: clientTextDelta
      ? (text) => {
          const visibleText = presentationStream.push(text);
          if (visibleText) clientTextDelta(visibleText);
        }
      : undefined,
  });

  const buildDetails = () =>
    JSON.stringify({
      full_prompt: turn.displayText,
      prompt_chars: turn.displayText.length,
      attachments: turn.images.map(({ id, width, height }) => ({
        id,
        width,
        height,
      })),
      iterations: detailState.iterations,
      tools: chatLogToolSummaries(toolDetails),
      usage,
      thread_id: thread.id,
      provider: selection.provider,
      model: selection.model,
      effort: detailState.effort ?? null,
      timing: {
        persistence_ms: detailState.persistence_ms ?? null,
        first_text_ms: detailState.first_text_ms ?? null,
      },
      ...(detailState.cursor ? { cursor: detailState.cursor } : {}),
    });

  try {
    const result = await runCoachProviderTurn({
      userId,
      threadId: thread.id,
      selection,
      turn,
      conversation,
      anthropicApiKey: apiKey,
      anthropicApiKeyOrigin: apiKeyOrigin,
      toolDetails,
      usage,
      detailState,
      options: providerOptions,
      accumulator,
    });
    detailState.iterations = result.iterations;
    const durationMs = Date.now() - startMs;
    const workLog = workLogCollector.complete(durationMs, toolDetails);
    const presentation = extractCoachPresentation(result.reply);
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const message = result.messages[index];
      if (message?.role === "assistant" && message.content === result.reply) {
        message.content = presentation.reply;
        message.work_log = workLog;
        message.presentation_blocks = presentation.presentationBlocks;
        break;
      }
    }
    const persistenceStartedMs = Date.now();
    addChatMessages(thread.id, result.messages);
    detailState.persistence_ms = Date.now() - persistenceStartedMs;
    handle?.markCommitted();
    addChatLog({
      user_id: userId,
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: durationMs,
      status: "ok",
      response_length: result.reply.length,
      error_message: null,
      days_context: days,
      type: "api",
      source,
      details: buildDetails(),
      thread_id: thread.id,
    });
    return {
      reply: presentation.reply,
      workLog,
      presentationBlocks: presentation.presentationBlocks,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addChatLog({
      user_id: userId,
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "error",
      response_length: 0,
      error_message: msg.slice(0, 500),
      days_context: days,
      type: "api",
      source,
      details: buildDetails(),
      thread_id: thread.id,
    });
    throw err;
  }
}

export async function titleChatThread(
  userId: number,
  threadId: number,
  firstUserText: string,
  apiKey: string,
): Promise<void> {
  // Prefer an LLM-generated title; fall back to a derived one so a thread is
  // always named even when Anthropic is unavailable. Never throws.
  let title = "";
  const lock = acquireGenerationLock(userId, "title", apiKey);
  if (!lock) {
    const fallback = deriveTitleFromText(firstUserText);
    if (fallback) setChatThreadTitle(threadId, fallback);
    return;
  }
  try {
    const client = new Anthropic({ apiKey, ...GENERATION_CLIENT_OPTIONS });
    // Issue #587 — resolve the configured title model against the account
    // catalog (same-family fallback) and build the reasoning fields through
    // anthropicReasoningConfig so thinking/effort only reached models that
    // accept them. Titles need no reasoning; "off" normalizes to a supported
    // effort when a model rejects disabled thinking.
    const { model, option } = await resolveCatalogModel(apiKey, titleModel());
    const response = await client.messages.create({
      model,
      max_tokens: 30,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Title this conversation: "${firstUserText}"`,
        },
      ],
      ...(option ? anthropicReasoningConfig("off", option, 30) : {}),
    }, { signal: AbortSignal.timeout(GENERATION_DEADLINE_MS) });
    title = textFromContent(response.content)
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim()
      .slice(0, 80);
    if (!title) throw new Error("Empty title response");
    clearGenerationFailure(userId, "title");
  } catch (err) {
    recordGenerationFailure(userId, "title", classifyGenerationError(err), apiKey);
  } finally {
    releaseSettingLock(lock);
  }
  if (!title) title = deriveTitleFromText(firstUserText);
  if (title) {
    setChatThreadTitle(threadId, title);
  }
}
