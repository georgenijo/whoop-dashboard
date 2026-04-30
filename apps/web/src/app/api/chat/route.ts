import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { after } from "next/server";
import {
  addChatLog,
  addChatMessages,
  createChatThread,
  getChatThreadById,
  getChatThreadConversation,
  setChatThreadTitle,
  type ChatMessageInsert,
} from "@/lib/db";
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
const TITLE_MODEL = "claude-haiku-4-5";
const TITLE_SYSTEM_PROMPT = "You title chat threads. Reply with a 3-6 word title only.";

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date is ${today}.
${DEFAULT_SYSTEM_PROMPT}`;
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
  threadId: number,
  toolUse: ToolUseBlock,
  toolDetails: ToolDetail[]
): Promise<ToolResultBlockParam> {
  const startMs = Date.now();
  console.info("[coach] tool_call", {
    thread_id: threadId,
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
      thread_id: threadId,
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
      thread_id: threadId,
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

async function runAnthropicSdk(
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
    messages: conversation,
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
    return { reply: `${partial}${suffix}`, iterations, messages: messagesToPersist };
  }

  if (response.stop_reason !== "end_turn") {
    throw new Error(`Claude stopped before finishing: ${response.stop_reason}`);
  }

  return { reply: assistantText, iterations, messages: messagesToPersist };
}

async function titleChatThread(threadId: number, firstUserText: string): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    console.warn("[coach] title_failed", {
      thread_id: threadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function parseThreadId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function responseWithThreadId(body: BodyInit | null, threadId: number, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-thread-id": String(threadId),
    },
  });
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = (await req.json()) as {
      messages: ChatMessageInput[];
      days?: number | null;
      thread_id?: number | string | null;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response("Error: messages must include at least one item", {
        status: 400,
      });
    }

    const lastUser = body.messages[body.messages.length - 1].content;
    const requestedThreadId = parseThreadId(body.thread_id);
    if (Number.isNaN(requestedThreadId as number)) {
      return new Response("Error: thread_id must be a positive integer", { status: 400 });
    }

    let thread = requestedThreadId == null ? createChatThread(user.id) : getChatThreadById(user.id, requestedThreadId);
    if (!thread) {
      return new Response("Error: thread not found", { status: 404 });
    }

    const conversation = getChatThreadConversation(user.id, thread.id) as MessageParam[];
    const shouldAutoTitle =
      !thread.title?.trim() &&
      !conversation.some((message) => message.role === "assistant");
    conversation.push({ role: "user", content: lastUser });

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
        thread_id: thread?.id,
      });

    try {
      const result = await runAnthropicSdk(
        thread.id,
        lastUser,
        conversation,
        toolDetails,
        usage,
        detailState
      );
      const reply = result.reply;
      detailState.iterations = result.iterations;
      addChatMessages(thread.id, result.messages);
      addChatLog({
        started_at: startedAt,
        prompt_preview: promptPreview,
        duration_ms: Date.now() - startMs,
        status: "ok",
        response_length: reply.length,
        error_message: null,
        days_context: body.days ?? null,
        type: "api",
        details: buildDetails(),
      });

      if (shouldAutoTitle) {
        after(() => {
          void titleChatThread(thread!.id, lastUser);
        });
      }

      return responseWithThreadId(reply, thread.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addChatLog({
        started_at: startedAt,
        prompt_preview: promptPreview,
        duration_ms: Date.now() - startMs,
        status: "error",
        response_length: 0,
        error_message: msg.slice(0, 500),
        days_context: body.days ?? null,
        type: "api",
        details: buildDetails(),
      });
      return responseWithThreadId(`Error: ${msg}`, thread.id, 500);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
