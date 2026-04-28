import { spawnSync } from "child_process";
import { getHealthContext, addChatMessage, addChatLog } from "@/lib/db";

const SYSTEM_PROMPT = `You are a personal health and performance analyst reviewing Whoop biometric data.

Your job:
1. Identify meaningful patterns and trends (not just restate numbers)
2. Flag anomalies or concerning changes
3. Give specific, actionable recommendations
4. Compare recent performance to the user's own baseline (not population averages)
5. Be direct and concise — no fluff

Keep responses under 400 words. Use markdown formatting.`;

export async function POST(req: Request) {
  const { messages, days = 30 } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    days?: number;
  };

  const context = getHealthContext(days);

  // Build conversation history as plain text for the prompt
  const history = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const lastUser = messages[messages.length - 1].content;

  const prompt = [
    SYSTEM_PROMPT,
    `\nCurrent health data:\n${context}`,
    history ? `\nConversation so far:\n${history}` : "",
    `\nUser: ${lastUser}`,
  ]
    .filter(Boolean)
    .join("\n");

  addChatMessage("user", lastUser);

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const promptPreview = lastUser.slice(0, 200);

  try {
    // Strip ANTHROPIC_API_KEY so claude CLI uses its OAuth login instead of
    // trying to authenticate via the (invalid) env var.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    cleanEnv.HOME = "/home/george";

    const result = spawnSync(
      "/usr/local/bin/claude",
      ["-p", prompt, "--dangerously-skip-permissions", "--model", "sonnet"],
      {
        timeout: 120_000,
        env: cleanEnv,
        maxBuffer: 1024 * 1024 * 4,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `exit ${result.status}`);

    const reply = result.stdout.trim();
    addChatMessage("assistant", reply);
    addChatLog({
      started_at: startedAt,
      prompt_preview: promptPreview,
      duration_ms: Date.now() - startMs,
      status: "ok",
      response_length: reply.length,
      error_message: null,
      days_context: days,
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
    });
    return new Response(`Error: ${msg}`, { status: 500 });
  }
}
