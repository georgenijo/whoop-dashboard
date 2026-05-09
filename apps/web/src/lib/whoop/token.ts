import "server-only";
import fs from "node:fs/promises";
import {
  clientId,
  clientSecret,
  computeExpiresAtIso,
  saveTokens,
  tokensPath,
  type StoredTokens,
  WHOOP_TOKEN_URL,
} from "@/lib/auth";
import {
  getIntegration,
  integrationRowExists,
  setIntegrationNeedsReauth,
} from "@/lib/db/integrations";

// KEEP IN SYNC WITH streamlit/whoop/auth.py (load/refresh/save semantics).
// Lookup order on read:
//   1. integrations DB row (encrypted). If row exists but decrypts to null,
//      we DO NOT fall back to tokens.json — masking corruption that way is
//      worse than a hard upstream auth failure.
//   2. tokens.json (only when no DB row exists at all).

const REFRESH_BUFFER_S = 60;
const DEFAULT_USER_ID = 1;
const WHOOP_PROVIDER = "whoop";

let inflightRefresh: Promise<StoredTokens | null> | null = null;

function isStoredTokensShape(v: unknown): v is StoredTokens {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.access_token === "string" &&
    typeof o.refresh_token === "string" &&
    typeof o.expires_at === "string" &&
    typeof o.expires_in === "number"
  );
}

/**
 * Read tokens, preferring the encrypted integrations row.
 *
 * Returns:
 *   - StoredTokens if the DB row decrypts cleanly, OR if no row exists and
 *     tokens.json contains a valid record.
 *   - null when the DB row exists but cannot be decrypted, OR when neither
 *     source produces a valid record.
 */
async function loadTokens(): Promise<StoredTokens | null> {
  const integration = getIntegration(DEFAULT_USER_ID, WHOOP_PROVIDER);
  if (integration) {
    const raw = (integration.raw ?? {}) as Record<string, unknown>;
    const expiresIn =
      typeof raw.expires_in === "number" ? (raw.expires_in as number) : 0;
    return {
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      expires_at: integration.expires_at,
      expires_in: expiresIn,
      token_type: integration.token_type ?? undefined,
      scope: integration.scope ?? undefined,
    };
  }

  if (integrationRowExists(DEFAULT_USER_ID, WHOOP_PROVIDER)) {
    // Row exists but undecryptable. Do NOT fall back to tokens.json — that
    // would silently mask a corruption / wrong-key scenario.
    console.warn(
      "[token] integrations row present but undecryptable; refusing file fallback"
    );
    return null;
  }

  // No DB row — fall back to tokens.json (first-run / pre-migration).
  try {
    const data = await fs.readFile(tokensPath(), "utf8");
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string"
    ) {
      return null;
    }
    // Normalize legacy numeric `expires_at` → ISO 8601 string in-memory.
    // The migration script handles persistent normalization.
    if (typeof parsed.expires_at === "number") {
      parsed.expires_at = new Date(
        (parsed.expires_at as number) * 1000
      ).toISOString();
    }
    if (!isStoredTokensShape(parsed)) {
      // Tolerate missing expires_in by defaulting to 0 — `isExpired` will
      // then return true and force a refresh on next call.
      const fallback = {
        ...parsed,
        expires_in:
          typeof parsed.expires_in === "number" ? parsed.expires_in : 0,
      } as StoredTokens;
      if (typeof fallback.expires_at !== "string") return null;
      return fallback;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(tokens: StoredTokens, nowMs: number = Date.now()): boolean {
  const exp = Date.parse(tokens.expires_at);
  if (Number.isNaN(exp)) return true;
  return nowMs > exp - REFRESH_BUFFER_S * 1000;
}

async function refreshTokens(current: StoredTokens): Promise<StoredTokens | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  let resp: Response;
  try {
    resp = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Transient (timeout / network). Log but do NOT flip needs_reauth — a
    // brief outage isn't a credential failure and a spurious banner would
    // train the user to ignore it.
    console.error(
      `[token] refresh network error: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
  if (!resp.ok) {
    const bodyExcerpt: Record<string, unknown> = {};
    try {
      const parsed = (await resp.json()) as Record<string, unknown>;
      // Allowlist — never log raw body so we can't leak future token-shaped fields.
      // Truncate the free-text fields per RFC 6749 (description/hint are
      // server-supplied prose; cap to limit accidental token echo).
      for (const k of ["error", "error_description", "error_hint"]) {
        if (!(k in parsed)) continue;
        const v = parsed[k];
        bodyExcerpt[k] =
          typeof v === "string" && k !== "error" ? v.slice(0, 120) : v;
      }
    } catch {
      // body wasn't JSON; status alone is the signal.
    }
    console.error(
      `[token] refresh failed status=${resp.status} body=${JSON.stringify(bodyExcerpt)}`
    );
    // Flip flag only on definitive credential-rejection signals so a code
    // bug (e.g. `invalid_request` from a malformed body) doesn't masquerade
    // as expired credentials and train the user to reconnect.
    //
    // Allowlisted error codes cover the realistic "credentials are dead"
    // shapes Whoop / RFC 6749 / RFC 6750 emit on a refresh:
    //   - invalid_grant       — refresh token expired or revoked
    //   - invalid_token       — RFC 6750, server says token is no good
    //   - invalid_client      — client credentials rejected
    //   - unauthorized_client — client not allowed to use this grant
    // Status 401 / 403 catch the same intent without a parsable body.
    // Anything else (parse failure, unknown error code, 5xx, network) →
    // log only; a transient outage shouldn't pop a Reconnect banner.
    //
    // Non-atomic with the upsert. Single-process Next.js serializes via the
    // `inflightRefresh` singleton, but a concurrent Python sync
    // (sync/daily_sync.py) could in theory race a flag-set against a
    // follow-up reset. Acceptable today; P2 keepalive will reshape this.
    const REAUTH_ERROR_CODES = new Set([
      "invalid_grant",
      "invalid_token",
      "invalid_client",
      "unauthorized_client",
    ]);
    const errorCode =
      typeof bodyExcerpt.error === "string" ? bodyExcerpt.error : null;
    if (
      (errorCode && REAUTH_ERROR_CODES.has(errorCode)) ||
      resp.status === 401 ||
      resp.status === 403
    ) {
      setIntegrationNeedsReauth(DEFAULT_USER_ID, WHOOP_PROVIDER, true);
    }
    return null;
  }
  const data = (await resp.json()) as Omit<StoredTokens, "expires_at">;
  const stored: StoredTokens = {
    ...data,
    expires_at: computeExpiresAtIso(data.expires_in),
  };
  // saveTokens → upsertIntegration writes needs_reauth = 0 on every successful
  // write, so the flag self-resets here on a healthy refresh.
  await saveTokens(stored);
  return stored;
}

export async function getValidAccessToken(
  forceRefresh = false,
  hooks: { onRefresh?: () => void } = {},
): Promise<string | null> {
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

  // Fire onRefresh only on the originating call — joiners above skip it so
  // a single refresh emits exactly one progress event.
  // INVARIANT: no awaits between this fire and the `inflightRefresh`
  // assignment below. Single-thread JS guarantees no other caller can
  // observe `inflightRefresh === null` between these two lines, which is
  // what prevents double-emit. Do NOT insert telemetry / logging here.
  hooks.onRefresh?.();
  const refreshPromise = refreshTokens(tokens);
  inflightRefresh = refreshPromise.finally(() => {
    inflightRefresh = null;
  });
  const refreshed = await refreshPromise;
  return refreshed?.access_token ?? null;
}
