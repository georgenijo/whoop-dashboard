import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

const CACHE_EPHEMERAL = { type: "ephemeral" } as const;
import { type ChatMessageInsert } from "@/lib/db";
import { COACH_MODEL, buildSystemPrompt } from "./prompts";
import { TOOLS, executeToolResult, type ToolDetail } from "./tools";

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
};

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

export async function runAnthropicSdk(
  threadId: number,
  newUserText: string,
  conversation: MessageParam[],
  toolDetails: ToolDetail[],
  usage: Usage,
  detailState: DetailState
): Promise<{ reply: string; iterations: number; messages: ChatMessageInsert[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messagesToPersist: ChatMessageInsert[] = [
    {
      role: "user",
      content: newUserText,
      blocks: [{ type: "text", text: newUserText }],
    },
  ];

  let response = await client.messages.create({
    model: COACH_MODEL,
    thinking: { type: "adaptive" },
    tools: TOOLS,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrompt(),
    messages: withCacheBreakpoint(conversation),
  });
  addUsageTotals(usage, response.usage);
  console.info("[coach] model_response", {
    thread_id: threadId,
    stop_reason: response.stop_reason,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  let assistantText = textFromContent(response.content);
  messagesToPersist.push({
    role: "assistant",
    content: assistantText,
    blocks: response.content,
  });
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

    const toolResults = await Promise.all(
      toolUses.map((toolUse) => executeToolResult(threadId, toolUse, toolDetails))
    );
    messagesToPersist.push({
      role: "user",
      content: "[tool_result]",
      blocks: toolResults,
    });
    conversation.push({
      role: "user",
      content: toolResults,
    });

    response = await client.messages.create({
      model: COACH_MODEL,
      thinking: { type: "adaptive" },
      tools: TOOLS,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(),
      messages: conversation,
    });
    addUsageTotals(usage, response.usage);
    console.info("[coach] model_response", {
      thread_id: threadId,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    assistantText = textFromContent(response.content);
    messagesToPersist.push({
      role: "assistant",
      content: assistantText,
      blocks: response.content,
    });
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
