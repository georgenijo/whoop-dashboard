import { spawn } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import {
  getHealthContext,
  addChatMessage,
  addChatLog,
  getSetting,
} from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const DEFAULT_SYSTEM_PROMPT = `You are a personal health and performance analyst reviewing Whoop biometric data.

Your job:
1. Identify meaningful patterns and trends (not just restate numbers)
2. Flag anomalies or concerning changes
3. Give specific, actionable recommendations
4. Compare recent performance to the user's own baseline (not population averages)
5. Be direct and concise — no fluff

Keep responses under 400 words. Use markdown formatting.`;

type ChatMessageInput = { role: "user" | "assistant"; content: string };

function runClaudeCli(prompt: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    cleanEnv.HOME = "/home/george";

    const child = spawn(
      "/usr/local/bin/claude",
      ["-p", prompt, "--dangerously-skip-permissions", "--model", "sonnet"],
      { env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 180s"));
    }, 180_000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

async function runAnthropicSdk(
  systemPrompt: string,
  messages: ChatMessageInput[]
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  return text.trim();
}

export async function POST(req: Request) {
  try {
    await requireAuth(req);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const { messages, days = 9999 } = (await req.json()) as {
    messages: ChatMessageInput[];
    days?: number;
  };

  const context = getHealthContext(days);
  const lastUser = messages[messages.length - 1].content;

  addChatMessage("user", lastUser);

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const promptPreview = lastUser.slice(0, 200);

  const useApi =
    getSetting("use_api_mode") === "1" && !!process.env.ANTHROPIC_API_KEY;
  const systemPrompt = getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT;

  try {
    let reply: string;

    if (useApi) {
      const systemWithContext = `${systemPrompt}\n\nCurrent health data:\n${context}`;
      reply = await runAnthropicSdk(systemWithContext, messages);
    } else {
      const history = messages
        .slice(0, -1)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const prompt = [
        systemPrompt,
        `\nCurrent health data:\n${context}`,
        history ? `\nConversation so far:\n${history}` : "",
        `\nUser: ${lastUser}`,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await runClaudeCli(prompt);
      if (result.code !== 0) {
        throw new Error(result.stderr || `claude exited ${result.code}`);
      }
      reply = result.stdout.trim();
    }

    addChatMessage("assistant", reply);
    addChatLog({
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "ok",
      response_length: reply.length,
      error_message: null,
      days_context: days,
      type: useApi ? "api" : "cli",
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
      type: useApi ? "api" : "cli",
    });
    return new Response(`Error: ${msg}`, { status: 500 });
  }
}
