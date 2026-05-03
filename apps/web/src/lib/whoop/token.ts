import "server-only";
import fs from "node:fs/promises";
import {
  clientId,
  clientSecret,
  saveTokens,
  tokensPath,
  type StoredTokens,
  WHOOP_TOKEN_URL,
} from "@/lib/auth";

// KEEP IN SYNC WITH streamlit/whoop/auth.py:60-129 (load/refresh/save semantics)

const REFRESH_BUFFER_S = 60;

let inflightRefresh: Promise<StoredTokens | null> | null = null;

async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const data = await fs.readFile(tokensPath(), "utf8");
    const parsed = JSON.parse(data) as StoredTokens;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(tokens: StoredTokens, nowS: number = Date.now() / 1000): boolean {
  return nowS > (tokens.expires_at ?? 0) - REFRESH_BUFFER_S;
}

async function refreshTokens(current: StoredTokens): Promise<StoredTokens | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const resp = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Omit<StoredTokens, "expires_at">;
  const stored: StoredTokens = {
    ...data,
    expires_at: Date.now() / 1000 + data.expires_in,
  };
  await saveTokens(stored);
  return stored;
}

export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
  const existing = inflightRefresh;
  if (existing) {
    return (await existing)?.access_token ?? null;
  }

  const tokens = await loadTokens();
  if (!tokens) return null;
  if (!forceRefresh && !isExpired(tokens)) {
    return tokens.access_token;
  }

  // Re-check after the async gap above: a concurrent webhook may have started
  // a refresh between our loadTokens() await and here. Join it if so.
  const existingAfterLoad = inflightRefresh;
  if (existingAfterLoad) {
    return (await existingAfterLoad)?.access_token ?? null;
  }

  const refreshPromise = refreshTokens(tokens);
  inflightRefresh = refreshPromise.finally(() => {
    inflightRefresh = null;
  });
  const refreshed = await refreshPromise;
  return refreshed?.access_token ?? null;
}
