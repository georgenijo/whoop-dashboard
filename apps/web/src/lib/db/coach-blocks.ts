import "server-only";
import { hasTable, safeQuery } from "./connection";

// Issue #392 — flatten chat_messages.blocks chain for the /logs row expand.

export type CoachBlock =
  | { type: "user_text"; ts: string; content: string }
  | { type: "thinking"; ts: string; content: string }
  | { type: "assistant_text"; ts: string; content: string }
  | {
      type: "tool_use";
      ts: string;
      tool_name: string;
      tool_use_id: string;
      tool_input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      ts: string;
      tool_use_id: string;
      content: string;
    };

type MessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  blocks: string | null;
  created_at: string;
};

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | unknown[];
    };

function blockText(b: AnthropicBlock): string {
  if (b.type === "text") return b.text;
  if (b.type === "thinking") return b.thinking;
  if (b.type === "tool_result") {
    if (typeof b.content === "string") return b.content;
    try {
      return JSON.stringify(b.content);
    } catch {
      return "[unserializable]";
    }
  }
  return "";
}

export function getThreadBlocks(threadId: number, userId?: number): CoachBlock[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) return [];
      if (userId != null) {
        const owns = db
          .prepare("SELECT id FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1")
          .get(threadId, userId);
        if (!owns) return [];
      }
      const rows = db
        .prepare(
          `SELECT id, role, content, blocks, created_at
           FROM chat_messages
           WHERE thread_id = ?
           ORDER BY id ASC`,
        )
        .all(threadId) as MessageRow[];

      const out: CoachBlock[] = [];
      for (const row of rows) {
        if (row.role === "user" && row.content !== "[tool_result]") {
          out.push({ type: "user_text", ts: row.created_at, content: row.content });
        }
        if (!row.blocks) {
          if (row.role === "assistant" && row.content.trim()) {
            out.push({
              type: "assistant_text",
              ts: row.created_at,
              content: row.content,
            });
          }
          continue;
        }
        let parsed: AnthropicBlock[] | null = null;
        try {
          parsed = JSON.parse(row.blocks) as AnthropicBlock[];
        } catch {
          parsed = null;
        }
        if (!Array.isArray(parsed)) continue;
        for (const b of parsed) {
          if (b.type === "text") {
            if (row.role === "user") continue;
            const text = blockText(b);
            if (text.trim()) {
              out.push({ type: "assistant_text", ts: row.created_at, content: text });
            }
          } else if (b.type === "thinking") {
            const text = blockText(b);
            if (text.trim()) {
              out.push({ type: "thinking", ts: row.created_at, content: text });
            }
          } else if (b.type === "tool_use") {
            const input =
              b.input && typeof b.input === "object"
                ? (b.input as Record<string, unknown>)
                : { value: b.input };
            out.push({
              type: "tool_use",
              ts: row.created_at,
              tool_name: b.name,
              tool_use_id: b.id,
              tool_input: input,
            });
          } else if (b.type === "tool_result") {
            out.push({
              type: "tool_result",
              ts: row.created_at,
              tool_use_id: b.tool_use_id,
              content: blockText(b),
            });
          }
        }
      }
      return out;
    }) ?? []
  );
}
