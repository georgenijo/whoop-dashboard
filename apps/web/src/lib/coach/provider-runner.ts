import "server-only";

import type { ChatMessageInsert } from "@/lib/db";
import type { ApiKeyOrigin } from "./api-key";
import {
  runAnthropicSdk,
  type DetailState,
  type RunAnthropicOptions,
  type Usage,
} from "./loop";
import type { CoachConversationMessage, CoachUserTurn } from "./image-types";
import type { CoachModelSelection } from "./provider";
import type { ToolDetail } from "./tools";
import { runCursorProviderTurn } from "./cursor-provider-adapter";

export type CoachProviderTurnResult = {
  reply: string;
  iterations: number;
  messages: ChatMessageInsert[];
};

export type CoachProviderTurnInput = {
  userId: number;
  threadId: number;
  selection: CoachModelSelection;
  turn: CoachUserTurn;
  conversation: CoachConversationMessage[];
  anthropicApiKey: string;
  anthropicApiKeyOrigin: ApiKeyOrigin;
  toolDetails: ToolDetail[];
  usage: Usage;
  detailState: DetailState;
  options: RunAnthropicOptions;
  accumulator?: ChatMessageInsert[];
};

/**
 * Stable provider boundary for Coach orchestration. The route and persistence
 * layers own authentication, streaming, logs, and messages; adapters own only
 * provider-specific execution.
 */
export async function runCoachProviderTurn(
  input: CoachProviderTurnInput,
): Promise<CoachProviderTurnResult> {
  if (input.selection.provider === "cursor") {
    return runCursorProviderTurn({
      userId: input.userId,
      threadId: input.threadId,
      model: input.selection.model,
      modelParameters: input.selection.parameters ?? [],
      turn: input.turn,
      conversation: input.conversation,
      toolDetails: input.toolDetails,
      usage: input.usage,
      detailState: input.detailState,
      options: input.options,
      accumulator: input.accumulator,
    });
  }

  return runAnthropicSdk(
    input.userId,
    input.threadId,
    input.turn,
    input.conversation,
    input.toolDetails,
    input.usage,
    input.detailState,
    input.anthropicApiKey,
    input.anthropicApiKeyOrigin,
    input.options,
    input.accumulator,
  );
}
