import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
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
import { type ToolDetail, chatLogToolSummaries } from "./tools";
import { resolveCoachProvider } from "./provider";
import { runCursorTurn } from "./cursor-loop";
import { forModule } from "@/lib/logger";

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
  lastUser: string,
  conversation: MessageParam[],
  days: number | null,
  source: AuthSource,
  apiKey: string,
  apiKeyOrigin: ApiKeyOrigin,
  options: RunAnthropicOptions = {},
  handle?: CoachTurnHandle
): Promise<string> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const promptPreview = lastUser.slice(0, 200);
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

  const buildDetails = () =>
    JSON.stringify({
      full_prompt: lastUser,
      prompt_chars: lastUser.length,
      iterations: detailState.iterations,
      tools: chatLogToolSummaries(toolDetails),
      usage,
      thread_id: thread.id,
      provider: selection.provider,
      model: selection.model,
    });

  try {
    const result =
      selection.provider === "cursor"
        ? await runCursorTurn({
            userId,
            threadId: thread.id,
            newUserText: lastUser,
            conversation,
            toolDetails,
            usage,
            detailState,
            options,
            accumulator,
          })
        : await runAnthropicSdk(
            userId,
            thread.id,
            lastUser,
            conversation,
            toolDetails,
            usage,
            detailState,
            apiKey,
            apiKeyOrigin,
            options,
            accumulator
          );
    detailState.iterations = result.iterations;
    addChatMessages(thread.id, result.messages);
    handle?.markCommitted();
    addChatLog({
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "ok",
      response_length: result.reply.length,
      error_message: null,
      days_context: days,
      type: "api",
      source,
      details: buildDetails(),
      thread_id: thread.id,
    });
    return result.reply;
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
    const title = textFromContent(response.content)
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim()
      .slice(0, 80);
    if (title) {
      setChatThreadTitle(threadId, title);
    }
  } catch (err) {
    log.warn(
      {
        thread_id: threadId,
        err: err instanceof Error ? err.message : String(err),
      },
      "title_failed",
    );
  }
}
