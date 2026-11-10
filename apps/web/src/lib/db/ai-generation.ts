import "server-only";
import { hasTable, openWrite } from "./connection";
import { forUser } from "./scoped";

export type GenerationKind = "insight" | "title";
export type GenerationErrorClass = "no_key" | "bad_key" | "provider_error";
export type GenerationFailure = {
  last_failed_at: string;
  error_class: GenerationErrorClass;
  failure_count: number;
  key_hash: string | null;
};

export function getGenerationFailure(userId: number, kind: GenerationKind): GenerationFailure | null {
  return forUser(userId).read((db, uid) => {
    if (!hasTable(db, "ai_generation_state")) return null;
    return db.prepare(
      "SELECT last_failed_at, error_class, failure_count, key_hash FROM ai_generation_state WHERE kind = ? AND user_id = ?",
    ).get(kind, uid) as GenerationFailure | undefined ?? null;
  });
}

export function saveGenerationFailure(
  userId: number, kind: GenerationKind, errorClass: GenerationErrorClass, keyHash: string | null,
): void {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    db.prepare(`
      INSERT INTO ai_generation_state (user_id, kind, last_failed_at, error_class, failure_count, key_hash)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        last_failed_at = excluded.last_failed_at, error_class = excluded.error_class,
        failure_count = CASE WHEN key_hash IS excluded.key_hash THEN failure_count + 1 ELSE 1 END,
        key_hash = excluded.key_hash
    `).run(userId, kind, new Date().toISOString(), errorClass, keyHash);
  } finally {
    db.close();
  }
}

export function clearGenerationFailure(userId: number, kind: GenerationKind): void {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    db.prepare("DELETE FROM ai_generation_state WHERE kind = ? AND user_id = ?").run(kind, userId);
  } finally {
    db.close();
  }
}
