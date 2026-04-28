import Anthropic from "@anthropic-ai/sdk";
import { getHealthContext } from "@/lib/db";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  const systemWithContext = `${SYSTEM_PROMPT}\n\nCurrent health data:\n${context}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const anthropicStream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemWithContext,
        messages,
      });

      for await (const event of anthropicStream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
