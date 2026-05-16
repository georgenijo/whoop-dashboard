import "server-only";
import { type DB, hasTable, openWrite, safeWriteQuery } from "./connection";

// Cap the conversation history sent to the model to keep input-token cost bounded.
// Only applies to model-input fetches (getChatThreadConversation / getChatConversation).
// UI fetches (getChatThreadMessages / getChatMessages) remain unbounded.
const MAX_HISTORY_ROWS = 30;

export type ChatThread = {
  id: number;
  user_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatThreadSummary = {
  id: number;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_preview: string | null;
};

export type ChatMessageStatus = "complete" | "aborted";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status: ChatMessageStatus;
};

export type ChatMessageInsert = {
  role: "user" | "assistant";
  content: string;
  blocks?: unknown;
};

function visibleChatMessageClause(alias: string): string {
  return `${alias}.content != '[tool_result]' AND NOT (${alias}.role = 'assistant' AND ${alias}.blocks LIKE '%"type":"tool_use"%')`;
}

/** Like visibleChatMessageClause but also excludes aborted assistant messages (used for last_preview). */
function visibleChatPreviewClause(alias: string): string {
  return `${visibleChatMessageClause(alias)} AND (${alias}.status IS NULL OR ${alias}.status != 'aborted' OR ${alias}.role != 'assistant')`;
}

function hasChatThread(db: DB, threadId: number, userId?: number): boolean {
  const row =
    userId == null
      ? db.prepare("SELECT id FROM chat_threads WHERE id = ? LIMIT 1").get(threadId)
      : db
          .prepare("SELECT id FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1")
          .get(threadId, userId);
  return !!row;
}

export function getChatThreads(userId: number): ChatThreadSummary[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return [] as ChatThreadSummary[];
      const visibleM = visibleChatMessageClause("m");
      const previewM2 = visibleChatPreviewClause("m2");
      return db
        .prepare(`
          SELECT
            t.id,
            t.title,
            t.updated_at,
            COUNT(m.id) AS message_count,
            (
              SELECT m2.content
              FROM chat_messages m2
              WHERE m2.thread_id = t.id AND ${previewM2}
              ORDER BY m2.id DESC
              LIMIT 1
            ) AS last_preview
          FROM chat_threads t
          LEFT JOIN chat_messages m
            ON m.thread_id = t.id AND ${visibleM}
          WHERE t.user_id = ?
          GROUP BY t.id
          ORDER BY t.updated_at DESC, t.id DESC
        `)
        .all(userId) as ChatThreadSummary[];
    }) ?? []
  );
}

export function getLatestChatThread(userId: number): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const row = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1"
        )
        .get(userId) as ChatThread | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function getChatThreadById(userId: number, threadId: number): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const row = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1"
        )
        .get(threadId, userId) as ChatThread | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function createChatThread(userId: number, title: string | null = null): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const result = db
        .prepare("INSERT INTO chat_threads (user_id, title) VALUES (?, ?)")
        .run(userId, title);
      const thread = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE id = ? LIMIT 1"
        )
        .get(Number(result.lastInsertRowid)) as ChatThread | undefined;
      return thread ?? null;
    }) ?? null
  );
}

export function touchChatThread(threadId: number): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(threadId);
  } finally {
    db.close();
  }
}

export function setChatThreadTitle(threadId: number, title: string | null): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, threadId);
  } finally {
    db.close();
  }
}

export function deleteChatThread(threadId: number, userId: number): boolean {
  const db = openWrite();
  if (!db) return false;
  try {
    const getThread = db.prepare(
      "SELECT id FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1"
    );
    const deleteMessages = db.prepare("DELETE FROM chat_messages WHERE thread_id = ?");
    // Lane F's chat_logs.thread_id REFERENCES chat_threads(id) has no
    // ON DELETE action, so any log row pointing at this thread blocks the
    // parent delete via FK. Drop the log rows in the same transaction.
    const deleteLogs = db.prepare("DELETE FROM chat_logs WHERE thread_id = ?");
    const deleteThread = db.prepare("DELETE FROM chat_threads WHERE id = ? AND user_id = ?");
    const removeThread = db.transaction(() => {
      const thread = getThread.get(threadId, userId) as { id: number } | undefined;
      if (!thread) return false;
      deleteMessages.run(threadId);
      deleteLogs.run(threadId);
      deleteThread.run(threadId, userId);
      return true;
    });
    return removeThread() as boolean;
  } finally {
    db.close();
  }
}

export function resolveChatThread(
  userId: number,
  threadId: number | null | undefined,
  createIfMissing = false
): ChatThread | null {
  if (threadId != null) {
    return getChatThreadById(userId, threadId);
  }
  const latest = getLatestChatThread(userId);
  if (latest) return latest;
  if (!createIfMissing) return null;
  return createChatThread(userId, null);
}

export function getOrCreateChatThread(userId: number): ChatThread | null {
  return resolveChatThread(userId, null, true);
}

export function getChatThreadSummary(userId: number, threadId: number): ChatThreadSummary | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const visibleM = visibleChatMessageClause("m");
      const previewM2 = visibleChatPreviewClause("m2");
      const row = db
        .prepare(
          `
          SELECT
            t.id,
            t.title,
            t.updated_at,
            COUNT(m.id) AS message_count,
            (
              SELECT m2.content
              FROM chat_messages m2
              WHERE m2.thread_id = t.id AND ${previewM2}
              ORDER BY m2.id DESC
              LIMIT 1
            ) AS last_preview
          FROM chat_threads t
          LEFT JOIN chat_messages m
            ON m.thread_id = t.id AND ${visibleM}
          WHERE t.id = ? AND t.user_id = ?
          GROUP BY t.id
          LIMIT 1
        `
        )
        .get(threadId, userId) as ChatThreadSummary | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function getChatThreadMessages(userId: number, threadId: number): ChatMessage[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) {
        return [] as ChatMessage[];
      }
      if (!hasChatThread(db, threadId, userId)) return [] as ChatMessage[];
      const visibleMessage = visibleChatMessageClause("chat_messages");
      const rows = db
        .prepare(
          `SELECT id, role, content, created_at, status FROM chat_messages WHERE thread_id = ? AND ${visibleMessage} ORDER BY id ASC`
        )
        .all(threadId) as {
          id: number;
          role: "user" | "assistant";
          content: string;
          created_at: string;
          status: string | null;
        }[];
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        status: row.status === "aborted" ? "aborted" : "complete",
      }));
    }) ?? []
  );
}

export function getChatThreadConversation(
  userId: number,
  threadId: number
): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) {
        return [] as { role: "user" | "assistant"; content: unknown }[];
      }
      if (!hasChatThread(db, threadId, userId)) {
        return [] as { role: "user" | "assistant"; content: unknown }[];
      }
      const rows = db
        .prepare(
          "SELECT role, content, blocks FROM chat_messages WHERE thread_id = ? AND (status IS NULL OR status != 'aborted') ORDER BY id DESC LIMIT ?"
        )
        .all(threadId, MAX_HISTORY_ROWS) as {
          role: "user" | "assistant";
          content: string;
          blocks: string | null;
        }[];
      rows.reverse();
      const conversation = rows.map((row) => {
        if (row.blocks !== null) {
          try {
            return {
              role: row.role,
              content: JSON.parse(row.blocks),
            };
          } catch {
            return {
              role: row.role,
              content: row.content,
            };
          }
        }
        return {
          role: row.role,
          content: row.content,
        };
      });
      // Anthropic rejects orphan tool_result (no preceding tool_use in window),
      // so drop any leading tool_result messages the LIMIT may have stranded.
      let cut = 0;
      while (cut < conversation.length) {
        const msg = conversation[cut];
        if (msg.role !== "user" || !Array.isArray(msg.content)) break;
        const hasToolResult = (msg.content as { type?: unknown }[]).some(
          (block) => block && block.type === "tool_result"
        );
        if (!hasToolResult) break;
        cut += 1;
      }
      return conversation.slice(cut);
    }) ?? []
  );
}

export function getChatMessages(threadId = 1): ChatMessage[] {
  return getChatThreadMessages(1, threadId);
}

export function getChatConversation(threadId = 1): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return getChatThreadConversation(1, threadId);
}

export function getLegacyChatThreadId(): number {
  return 1;
}

export function getLegacyChatMessages(): ChatMessage[] {
  return getChatMessages(1);
}

export function getLegacyChatConversation(): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return getChatConversation(1);
}

export function addChatMessage(
  threadId: number,
  role: "user" | "assistant",
  content: string,
  blocks?: unknown
): void {
  addChatMessages(threadId, [{ role, content, blocks }]);
}

export function addChatMessages(
  threadId: number,
  messages: ChatMessageInsert[],
  status: ChatMessageStatus = "complete"
): void {
  if (messages.length === 0) return;

  const db = openWrite();
  if (!db) return;
  try {
    const insert = db.prepare(
      "INSERT INTO chat_messages (thread_id, role, content, blocks, created_at, status) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const touch = db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?");
    // When status='aborted', only the final assistant row in the batch
    // represents the interrupted reply; earlier rows (user prompt, prior
    // tool turns) were completed normally and stay 'complete'.
    const lastAssistantIdx = (() => {
      if (status !== "aborted") return -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "assistant") return i;
      }
      return -1;
    })();
    const writeTurn = db.transaction((rows: ChatMessageInsert[]) => {
      rows.forEach((message, idx) => {
        insert.run(
          threadId,
          message.role,
          message.content,
          message.blocks === undefined ? null : JSON.stringify(message.blocks),
          new Date().toISOString(),
          idx === lastAssistantIdx ? "aborted" : "complete"
        );
      });
      touch.run(threadId);
    });
    writeTurn(messages);
  } finally {
    db.close();
  }
}

export function clearChatMessages(threadId = 1): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(threadId);
    db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(threadId);
  } finally {
    db.close();
  }
}
