import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { addChatMessage, addChatLog } from "@/lib/db";
import { executeTool, ToolInputError, TOOLS } from "@/lib/coach-tools";
import { requireAuth } from "@/lib/auth";

export const DEFAULT_SYSTEM_PROMPT = `You are a personal health and performance analyst for a single user. You have tools to query their Whoop wearable data and any journal entries. Use the tools before answering with specific numbers and dates — never guess values.

# Tools

You have five read-only tools, each scoped to a YYYY-MM-DD date range. Set start_date = end_date for a single day.

- query_recovery(start_date, end_date) — daily recovery rows. Returns recovery_score (0-100), HRV in ms, resting heart rate (bpm), SpO2 (%), skin temperature (°C). Use for recovery, HRV, RHR, blood oxygen, or skin temp questions.
- query_sleep(start_date, end_date) — nightly sleep rows. Excludes naps. Returns in-bed/light/deep/REM/awake durations, sleep need, sleep performance (%), efficiency (%), disturbances count, respiratory rate (bpm). Use for sleep stages, latency, efficiency, awakenings, or breathing questions.
- query_strain(start_date, end_date) — daily strain rows. Returns day strain (0-21), kilojoules burned, average HR, max HR. Use for daily exertion or cardiovascular load.
- query_workouts(start_date, end_date) — individual workout rows. Returns sport, duration, avg/max HR, per-workout strain, kilojoules. Use for specific sessions or per-sport comparisons.
- query_journal(start_date, end_date) — user-written notes. May return empty if no journal exists.

# Tool selection rules

- "Yesterday" = today minus one day. Convert to YYYY-MM-DD before calling.
- "This week" = the last 7 days inclusive of today.
- "Last month" = the prior calendar month (not the last 30 days). Be precise about month boundaries.
- Multi-metric questions may need multiple tool calls. Call them in parallel when possible.
- Comparison questions ("did high strain hurt my sleep?") need both query_strain and query_sleep over the same window.
- If a tool returns an empty array, say so plainly — never invent numbers.

# Metric reference ranges

- Recovery score: 67+ = green (ready for high strain), 34-66 = yellow (moderate, listen to your body), 0-33 = red (prioritize rest). Combines HRV, RHR, sleep performance, and respiratory rate.
- HRV (ms): personal baseline matters more than absolute value. Trends over weeks are more meaningful than day-to-day swings.
- Resting heart rate (bpm): overnight average. Spikes typically signal stress, illness, alcohol, or late meals.
- Day strain (0-21, logarithmic): 0-9 light, 10-13 moderate, 14-17 high, 18+ all-out. Going 14+ on consecutive days usually predicts a recovery dip.
- Sleep performance (%): sleep got vs sleep need. 100% = met need.
- Sleep efficiency (%): time asleep vs time in bed. 90%+ is excellent.
- Respiratory rate (bpm): personal baseline matters; sustained increases of 1-2 bpm can signal illness or hard training load.

# Output style

- Be direct and concise. Aim for 1-3 paragraphs unless the user asks for depth.
- Lead with the headline number or finding.
- Use markdown tables for any multi-row numeric comparison.
- Use markdown bullet lists for any multi-point recommendation.
- Bold the most important value in any answer.
- When the user asks "should I work out today?", weigh recovery + recent strain + sleep, then give a one-sentence recommendation followed by the rationale.
- When patterns are noteworthy (HRV declining, sleep debt building, strain unusually high), call them out proactively even if not asked.
- Never apologize for missing data — just state what's available.

# Boundaries

This is a single-user personal dashboard, not a clinical tool. Do not give medical advice or diagnose conditions. Suggest consulting a clinician for persistent abnormal patterns or symptoms (e.g., chest pain, sustained low SpO2, severe sleep disruption). Do not include generic "individual variation" or "consult your doctor" disclaimers on every reply — only when the user describes symptoms or asks about specific health conditions.`;

type ChatMessageInput = { role: "user" | "assistant"; content: string };

const MAX_TOOL_ITERATIONS = 8;
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

async function executeToolResult(toolUse: ToolUseBlock): Promise<ToolResultBlockParam> {
  const startMs = Date.now();
  console.info("[coach] tool_call", {
    name: toolUse.name,
    input: toolUse.input,
  });

  try {
    const result = await executeTool(toolUse.name, toolUse.input);
    const durationMs = Date.now() - startMs;
    console.info("[coach] tool_result", {
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows: Array.isArray(result) ? result.length : null,
      status: "ok",
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn("[coach] tool_result", {
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: toolErrorPayload(err),
      is_error: true,
    };
  }
}

async function runAnthropicSdk(messages: ChatMessageInput[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" },
  });
  const conversation: MessageParam[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  let response = await client.messages.create({
    model: COACH_MODEL,
    thinking: { type: "adaptive" },
    tools: TOOLS,
    max_tokens: 4096,
    system: [{
      type: "text",
      text: buildSystemPrompt(),
      cache_control: { type: "ephemeral", ttl: "1h" },
    }],
    messages: conversation,
  });
  console.info("[coach] model_response", {
    stop_reason: response.stop_reason,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  });

  let iterations = 0;
  while (response.stop_reason === "tool_use") {
    if (iterations >= MAX_TOOL_ITERATIONS) {
      throw new Error(`Tool-use iteration limit exceeded (${MAX_TOOL_ITERATIONS})`);
    }
    iterations += 1;

    const toolUses = response.content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      throw new Error("Claude stopped for tool_use without requesting a tool");
    }

    conversation.push({
      role: "assistant",
      content: response.content as ContentBlockParam[],
    });
    conversation.push({
      role: "user",
      content: await Promise.all(toolUses.map(executeToolResult)),
    });

    response = await client.messages.create({
      model: COACH_MODEL,
      thinking: { type: "adaptive" },
      tools: TOOLS,
      max_tokens: 4096,
      system: [{
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral", ttl: "1h" },
      }],
      messages: conversation,
    });
    console.info("[coach] model_response", {
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    });
  }

  if (response.stop_reason !== "end_turn") {
    throw new Error(`Claude stopped before finishing: ${response.stop_reason}`);
  }

  return textFromContent(response.content);
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

  addChatMessage("user", lastUser);

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const promptPreview = lastUser.slice(0, 200);

  try {
    const reply = await runAnthropicSdk(messages);

    addChatMessage("assistant", reply);
    addChatLog({
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "ok",
      response_length: reply.length,
      error_message: null,
      days_context: days,
      type: "api",
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
    });
    return new Response(`Error: ${msg}`, { status: 500 });
  }
}
