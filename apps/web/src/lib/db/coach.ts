import "server-only";
import { type DB, hasTable, openWrite, safeWriteQuery } from "./connection";
import {
  type ChatAttachment,
  type ChatAttachmentInsert,
  type CoachConversationMessage,
  type CoachImage,
} from "@/lib/coach/image-types";
import {
  assertKeyVersionSupported,
  CURRENT_KEY_VERSION,
  decryptBytes,
  encryptBytes,
} from "@/lib/crypto/vault";
import {
  parseCoachWorkLog,
  type CoachWorkLog,
} from "@/lib/coach/work-log-types";

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
  attachments: ChatAttachment[];
  work_log: CoachWorkLog | null;
};

export type ChatMessageInsert = {
  role: "user" | "assistant";
  content: string;
  blocks?: unknown;
  attachments?: ChatAttachmentInsert[];
  work_log?: CoachWorkLog;
};

type AttachmentRow = {
  id: string;
  message_id: number;
  mime_type: "image/jpeg";
  width: number;
  height: number;
  size_bytes: number;
  sha256: string;
  ciphertext: Buffer;
  key_version: number;
  ordinal: number;
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

function attachmentRows(db: DB, messageIds: number[]): AttachmentRow[] {
  if (messageIds.length === 0 || !hasTable(db, "chat_attachments")) return [];
  const placeholders = messageIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT
         a.id, ma.message_id, a.mime_type, a.width, a.height,
         a.size_bytes, a.sha256, a.ciphertext, a.key_version, ma.ordinal
       FROM chat_message_attachments ma
       JOIN chat_attachments a ON a.id = ma.attachment_id
       WHERE ma.message_id IN (${placeholders})
       ORDER BY ma.message_id, ma.ordinal`
    )
    .all(...messageIds) as AttachmentRow[];
}

function attachmentDto(row: AttachmentRow): ChatAttachment {
  return {
    id: row.id,
    url: `/api/chat/attachments/${row.id}`,
    mime_type: row.mime_type,
    width: row.width,
    height: row.height,
    size_bytes: row.size_bytes,
  };
}

function attachmentImage(row: AttachmentRow): CoachImage {
  assertKeyVersionSupported(row.key_version);
  return {
    id: row.id,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    bytes: decryptBytes(row.ciphertext),
    sha256: row.sha256,
  };
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
              SELECT CASE
                WHEN m2.content = '' AND EXISTS (
                  SELECT 1 FROM chat_message_attachments ma
                  WHERE ma.message_id = m2.id
                ) THEN 'Image attachment'
                ELSE m2.content
              END
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
    const deleteAttachments = db.prepare("DELETE FROM chat_attachments WHERE thread_id = ?");
    // Lane F's chat_logs.thread_id REFERENCES chat_threads(id) has no
    // ON DELETE action, so any log row pointing at this thread blocks the
    // parent delete via FK. Drop the log rows in the same transaction.
    const deleteLogs = db.prepare("DELETE FROM chat_logs WHERE thread_id = ?");
    const deleteThread = db.prepare("DELETE FROM chat_threads WHERE id = ? AND user_id = ?");
    const removeThread = db.transaction(() => {
      const thread = getThread.get(threadId, userId) as { id: number } | undefined;
      if (!thread) return false;
      deleteMessages.run(threadId);
      deleteAttachments.run(threadId);
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
              SELECT CASE
                WHEN m2.content = '' AND EXISTS (
                  SELECT 1 FROM chat_message_attachments ma
                  WHERE ma.message_id = m2.id
                ) THEN 'Image attachment'
                ELSE m2.content
              END
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
          `SELECT id, role, content, created_at, status, work_log FROM chat_messages WHERE thread_id = ? AND ${visibleMessage} ORDER BY id ASC`
        )
        .all(threadId) as {
          id: number;
          role: "user" | "assistant";
          content: string;
          created_at: string;
          status: string | null;
          work_log: string | null;
        }[];
      const attachmentMap = new Map<number, ChatAttachment[]>();
      for (const attachment of attachmentRows(db, rows.map((row) => row.id))) {
        const list = attachmentMap.get(attachment.message_id) ?? [];
        list.push(attachmentDto(attachment));
        attachmentMap.set(attachment.message_id, list);
      }
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        status: row.status === "aborted" ? "aborted" : "complete",
        attachments: attachmentMap.get(row.id) ?? [],
        work_log: parseCoachWorkLog(row.work_log),
      }));
    }) ?? []
  );
}

export function getChatThreadConversation(
  userId: number,
  threadId: number
): CoachConversationMessage[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) {
        return [] as CoachConversationMessage[];
      }
      if (!hasChatThread(db, threadId, userId)) {
        return [] as CoachConversationMessage[];
      }
      const rows = db
        .prepare(
          "SELECT id, role, content, blocks FROM chat_messages WHERE thread_id = ? AND (status IS NULL OR status != 'aborted') ORDER BY id DESC LIMIT ?"
        )
        .all(threadId, MAX_HISTORY_ROWS) as {
          id: number;
          role: "user" | "assistant";
          content: string;
          blocks: string | null;
        }[];
      rows.reverse();
      const imageMap = new Map<number, CoachImage[]>();
      const unavailableImageMessages = new Set<number>();
      for (const attachment of attachmentRows(db, rows.map((row) => row.id))) {
        try {
          const list = imageMap.get(attachment.message_id) ?? [];
          list.push(attachmentImage(attachment));
          imageMap.set(attachment.message_id, list);
        } catch {
          // A missing/rotated vault key must not break text-only Coach turns.
          // The attachment endpoint still fails closed; model history keeps the
          // surrounding text and asks for a reattachment instead of inventing.
          unavailableImageMessages.add(attachment.message_id);
        }
      }
      const conversation = rows.map((row) => {
        const unavailableMarker = unavailableImageMessages.has(row.id)
          ? [{
              type: "text",
              text:
                "[An attached image is unavailable to the model. Ask the user to reattach it before making a fresh visual analysis.]",
            }]
          : [];
        if (row.blocks !== null) {
          try {
            const parsed = JSON.parse(row.blocks) as unknown;
            return {
              role: row.role,
              contentBlocks: Array.isArray(parsed)
                ? [...parsed, ...unavailableMarker]
                : [{ type: "text", text: row.content }, ...unavailableMarker],
              images: imageMap.get(row.id) ?? [],
            };
          } catch {
            return {
              role: row.role,
              contentBlocks: [
                { type: "text", text: row.content },
                ...unavailableMarker,
              ],
              images: imageMap.get(row.id) ?? [],
            };
          }
        }
        return {
          role: row.role,
          contentBlocks: [
            { type: "text", text: row.content },
            ...unavailableMarker,
          ],
          images: imageMap.get(row.id) ?? [],
        };
      });
      // Anthropic rejects orphan tool_result (no preceding tool_use in window),
      // so drop any leading tool_result messages the LIMIT may have stranded.
      let cut = 0;
      while (cut < conversation.length) {
        const msg = conversation[cut];
        if (msg.role !== "user") break;
        const hasToolResult = (msg.contentBlocks as { type?: unknown }[]).some(
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

export function getChatConversation(threadId = 1): CoachConversationMessage[] {
  return getChatThreadConversation(1, threadId);
}

export function getLegacyChatThreadId(): number {
  return 1;
}

export function getLegacyChatMessages(): ChatMessage[] {
  return getChatMessages(1);
}

export function getLegacyChatConversation(): CoachConversationMessage[] {
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
      "INSERT INTO chat_messages (thread_id, role, content, blocks, work_log, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const threadOwner = db.prepare(
      "SELECT user_id FROM chat_threads WHERE id = ? LIMIT 1"
    );
    const insertAttachment = db.prepare(
      `INSERT INTO chat_attachments (
         id, thread_id, user_id, mime_type, width, height, size_bytes,
         sha256, ciphertext, key_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const linkAttachment = db.prepare(
      "INSERT INTO chat_message_attachments (message_id, attachment_id, ordinal) VALUES (?, ?, ?)"
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
      const owner = threadOwner.get(threadId) as { user_id: number } | undefined;
      if (!owner) throw new Error("chat thread not found");
      rows.forEach((message, idx) => {
        const inserted = insert.run(
          threadId,
          message.role,
          message.content,
          message.blocks === undefined ? null : JSON.stringify(message.blocks),
          message.work_log === undefined ? null : JSON.stringify(message.work_log),
          new Date().toISOString(),
          idx === lastAssistantIdx ? "aborted" : "complete"
        );
        const messageId = Number(inserted.lastInsertRowid);
        message.attachments?.forEach((attachment, ordinal) => {
          const ciphertext = encryptBytes(attachment.bytes);
          insertAttachment.run(
            attachment.id,
            threadId,
            owner.user_id,
            attachment.mimeType,
            attachment.width,
            attachment.height,
            attachment.bytes.length,
            attachment.sha256,
            ciphertext,
            CURRENT_KEY_VERSION,
          );
          linkAttachment.run(messageId, attachment.id, ordinal);
        });
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
    const clear = db.transaction(() => {
      db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(threadId);
      db.prepare("DELETE FROM chat_attachments WHERE thread_id = ?").run(threadId);
      db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(threadId);
    });
    clear();
  } finally {
    db.close();
  }
}

export function getChatAttachmentForUser(
  userId: number,
  attachmentId: string,
): (ChatAttachment & { bytes: Buffer; sha256: string }) | null {
  const db = openWrite();
  if (!db) return null;
  try {
    if (!hasTable(db, "chat_attachments")) return null;
    const row = db
      .prepare(
        `SELECT
           a.id, ma.message_id, a.mime_type, a.width, a.height,
           a.size_bytes, a.sha256, a.ciphertext, a.key_version, ma.ordinal
         FROM chat_attachments a
         JOIN chat_message_attachments ma ON ma.attachment_id = a.id
         JOIN chat_threads t ON t.id = a.thread_id
         WHERE a.id = ? AND a.user_id = ? AND t.user_id = ?
         LIMIT 1`
      )
      .get(attachmentId, userId, userId) as AttachmentRow | undefined;
    if (!row) return null;
    return {
      ...attachmentDto(row),
      bytes: attachmentImage(row).bytes,
      sha256: row.sha256,
    };
  } finally {
    db.close();
  }
}
