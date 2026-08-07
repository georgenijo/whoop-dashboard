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
import {
  type DetailState,
  type RunAnthropicOptions,
  type Usage,
  runAnthropicSdk,
  textFromContent,
} from "./loop";
import { TITLE_MODEL, TITLE_SYSTEM_PROMPT } from "./prompts";
import { deriveTitleFromText } from "./title";
import { type ToolDetail, chatLogToolSummaries } from "./tools";
import { resolveCoachProvider } from "./provider";
import { runCursorTurn } from "./cursor-loop";
import { CoachWorkLogCollector } from "./work-log";
import type { CoachWorkLog } from "./work-log-types";
import { forModule } from "@/lib/logger";
import type {
  CoachConversationMessage,
  CoachUserTurn,
} from "./image-types";

const log = forModule("coach.persistence");

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
): Promise<{ reply: string; workLog: CoachWorkLog }> {
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
  const providerOptions = workLogCollector.wrap(options);

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
      },
      ...(detailState.cursor ? { cursor: detailState.cursor } : {}),
    });

  try {
    const result =
      selection.provider === "cursor"
        ? await runCursorTurn({
            userId,
            model: selection.model,
            modelParameters: selection.parameters ?? [],
            threadId: thread.id,
            turn,
            conversation,
            toolDetails,
            usage,
            detailState,
            options: providerOptions,
            accumulator,
          })
        : await runAnthropicSdk(
            userId,
            thread.id,
            turn,
            conversation,
            toolDetails,
            usage,
            detailState,
            apiKey,
            apiKeyOrigin,
            providerOptions,
            accumulator
          );
    detailState.iterations = result.iterations;
    const durationMs = Date.now() - startMs;
    const workLog = workLogCollector.complete(durationMs, toolDetails);
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const message = result.messages[index];
      if (message?.role === "assistant" && message.content === result.reply) {
        message.work_log = workLog;
        break;
      }
    }
    const persistenceStartedMs = Date.now();
    addChatMessages(thread.id, result.messages);
    detailState.persistence_ms = Date.now() - persistenceStartedMs;
    handle?.markCommitted();
    addChatLog({
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
    return { reply: result.reply, workLog };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addChatLog({
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
  threadId: number,
  firstUserText: string,
  apiKey: string,
): Promise<void> {
  // Prefer an LLM-generated title; fall back to a derived one so a thread is
  // always named even when Anthropic is unavailable. Never throws.
  let title = "";
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 30,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Title this conversation: "${firstUserText}"`,
        },
      ],
    });
    title = textFromContent(response.content)
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim()
      .slice(0, 80);
  } catch (err) {
    log.warn(
      {
        thread_id: threadId,
        err: err instanceof Error ? err.message : String(err),
      },
      "title_failed",
    );
  }
  if (!title) title = deriveTitleFromText(firstUserText);
  if (title) {
    setChatThreadTitle(threadId, title);
  }
}
