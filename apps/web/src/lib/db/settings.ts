import "server-only";
import { randomUUID } from "node:crypto";
import { hasTable, openWrite, safeQuery } from "./connection";

export type SettingLock = {
  key: string;
  value: string;
};

export function getSetting(key: string): string | null {
  return safeQuery((db) => {
    if (!hasTable(db, "app_settings")) return null;
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });
}

function settingLockExpiresMs(value: string | null): number | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { expires_at?: unknown };
    if (typeof parsed.expires_at !== "string") return null;
    const ms = Date.parse(parsed.expires_at);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export function isSettingLockActive(key: string): boolean {
  const value = getSetting(key);
  const expiresMs = settingLockExpiresMs(value);
  return expiresMs !== null && expiresMs > Date.now();
}

export function acquireSettingLock(key: string, ttlMs: number): SettingLock | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const nowMs = Date.now();
    const value = JSON.stringify({
      token: randomUUID(),
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + ttlMs).toISOString(),
    });
    const select = db.prepare("SELECT value FROM app_settings WHERE key = ?");
    const upsert = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const acquire = db.transaction(() => {
      const row = select.get(key) as { value: string | null } | undefined;
      const expiresMs = settingLockExpiresMs(row?.value ?? null);
      if (expiresMs !== null && expiresMs > nowMs) return false;
      upsert.run(key, value);
      return true;
    });
    return (acquire.immediate() as boolean) ? { key, value } : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function releaseSettingLock(lock: SettingLock): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM app_settings WHERE key = ? AND value = ?").run(
      lock.key,
      lock.value
    );
  } finally {
    db.close();
  }
}

export function setSetting(key: string, value: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  } finally {
    db.close();
  }
}
