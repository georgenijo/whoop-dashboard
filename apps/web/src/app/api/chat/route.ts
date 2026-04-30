import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { addChatMessage, addChatLog, getChatConversation } from "@/lib/db";
import { executeTool, ToolInputError, TOOLS } from "@/lib/coach-tools";
import { requireAuth } from "@/lib/auth";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a personal health and performance analyst. You have tools to query the user's health data; use them as needed before answering with specific numbers and dates. Be direct, concise, and actionable.";

type ChatMessageInput = { role: "user" | "assistant"; content: string };

type ToolDetail = {
  name: string;
  input: unknown;
  duration_ms: number;
  rows: number | null;
  status: "ok" | "error";
  error?: string;
};

type Usage = {
  input_tokens_total: number;
  output_tokens_total: number;
  cache_creation_input_tokens_total: number;
  cache_read_input_tokens_total: number;
  calls: number;
};

type DetailState = {
  iterations: number;
};

const MAX_TOOL_ITERATIONS = 8;
const MAX_OUTPUT_TOKENS = 16384;
const COACH_MODEL = "claude-sonnet-4-6";

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date is ${today}.\n${DEFAULT_SYSTEM_PROMPT}`;
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

function textFromContent(content: ContentBlock[]): string {
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

function toolErrorPayload(err: unknown): string {
  if (err instanceof ToolInputError) {
    return JSON.stringify({
      error: err.message,
      details: err.details,
    });
  }
  return JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  });
}

async function executeToolResult(
  toolUse: ToolUseBlock,
  toolDetails: ToolDetail[]
): Promise<ToolResultBlockParam> {
  const startMs = Date.now();
  console.info("[coach] tool_call", {
    name: toolUse.name,
    input: toolUse.input,
  });

  try {
    const result = await executeTool(toolUse.name, toolUse.input);
    const durationMs = Date.now() - startMs;
    const rows = Array.isArray(result) ? result.length : null;
    toolDetails.push({
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows,
      status: "ok",
    });
    console.info("[coach] tool_result", {
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows,
      status: "ok",
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const error = err instanceof Error ? err.message : String(err);
    toolDetails.push({
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows: null,
      status: "error",
      error,
    });
    console.warn("[coach] tool_result", {
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      status: "error",
      error,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: toolErrorPayload(err),
      is_error: true,
    };
  }
}

function addUsageTotals(usage: Usage, responseUsage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): void {
  usage.input_tokens_total += responseUsage.input_tokens;
  usage.output_tokens_total += responseUsage.output_tokens;
  usage.cache_creation_input_tokens_total +=
    responseUsage.cache_creation_input_tokens ?? 0;
  usage.cache_read_input_tokens_total +=
    responseUsage.cache_read_input_tokens ?? 0;
  usage.calls += 1;
}

async function runAnthropicSdk(
  newUserText: string,
  toolDetails: ToolDetail[],
  usage: Usage,
  detailState: DetailState
): Promise<{ reply: string; iterations: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const conversation = getChatConversation() as MessageParam[];
  conversation.push({ role: "user", content: newUserText });
  addChatMessage("user", newUserText, [{ type: "text", text: newUserText }]);

  let response = await client.messages.create({
    model: COACH_MODEL,
    thinking: { type: "adaptive" },
    tools: TOOLS,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrompt(),
    messages: conversation,
  });
  addUsageTotals(usage, response.usage);
  console.info("[coach] model_response", {
    stop_reason: response.stop_reason,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  let assistantText = textFromContent(response.content);
  addChatMessage("assistant", assistantText, response.content);
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
      toolUses.map((toolUse) => executeToolResult(toolUse, toolDetails))
    );
    addChatMessage("user", "[tool_result]", toolResults);
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
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    assistantText = textFromContent(response.content);
    addChatMessage("assistant", assistantText, response.content);
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
    return { reply: `${partial}${suffix}`, iterations };
  }

  if (response.stop_reason !== "end_turn") {
    throw new Error(`Claude stopped before finishing: ${response.stop_reason}`);
  }

  return { reply: assistantText, iterations };
}

export async function POST(req: Request) {
  try {
    await requireAuth(req);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const { messages, days = null } = (await req.json()) as {
    messages: ChatMessageInput[];
    days?: number | null;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Error: messages must include at least one item", {
      status: 400,
    });
  }

  const lastUser = messages[messages.length - 1].content;

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

  const buildDetails = () =>
    JSON.stringify({
      full_prompt: lastUser,
      iterations: detailState.iterations,
      tools: toolDetails,
      usage,
    });

  try {
    const result = await runAnthropicSdk(
      lastUser,
      toolDetails,
      usage,
      detailState
    );
    const reply = result.reply;
    detailState.iterations = result.iterations;
    addChatLog({
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "ok",
      response_length: reply.length,
      error_message: null,
      days_context: days,
      type: "api",
      details: buildDetails(),
    });
    return new Response(reply, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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
      details: buildDetails(),
    });
    return new Response(`Error: ${msg}`, { status: 500 });
  }
}
