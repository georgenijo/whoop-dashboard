import { spawnSync } from "child_process";
import { getHealthContext } from "@/lib/db";

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

  try {
    const result = spawnSync(
      "/usr/local/bin/claude",
      ["-p", prompt, "--dangerously-skip-permissions", "--model", "sonnet"],
      {
        timeout: 120_000,
        env: { ...process.env, HOME: process.env.HOME ?? "/home/george" },
        maxBuffer: 1024 * 1024 * 4,
        encoding: "utf8",
      }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `exit ${result.status}`);

    return new Response(result.stdout.trim(), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`Error: ${msg}`, { status: 500 });
  }
}
