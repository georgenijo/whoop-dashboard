import "server-only";
import {
  clientId,
  clientSecret,
  computeExpiresAtIso,
  saveTokens,
  type StoredTokens,
  WHOOP_TOKEN_URL,
} from "@/lib/auth";
import {
  getIntegration,
  setIntegrationNeedsReauth,
} from "@/lib/db/integrations";

// Post-Phase-D: the encrypted `integrations` row is the sole token store.
// The legacy `tokens.json` file fallback (#330) is gone. If the row is
// missing or undecryptable, callers see `null` and route to the reauth path.

const REFRESH_BUFFER_S = 60;
const WHOOP_PROVIDER = "whoop";

// Definitive "credentials are dead, user must reconnect" error codes from
// Whoop / RFC 6749 / RFC 6750. Excluded on purpose:
//   - invalid_client / unauthorized_client → server-side config bugs (bad
//     WHOOP_CLIENT_ID/SECRET); reconnecting tokens won't help, so the
//     banner would mislead.
//   - invalid_request → our client bug (malformed body, missing param).
const REAUTH_ERROR_CODES = new Set(["invalid_grant", "invalid_token"]);

/**
 * Per-user in-flight refresh singletons. Keying on user_id (not a single
 * global) lets concurrent refreshes for distinct users proceed in parallel
 * while still serializing duplicates for the same user.
 */
const inflightRefreshByUser = new Map<number, Promise<StoredTokens | null>>();

/**
 * Read tokens for `userId` from the encrypted integrations row.
 *
 * Returns:
 *   - StoredTokens if the row exists AND decrypts cleanly.
 *   - null otherwise (no row, undecryptable row, or DB unavailable).
 *
 * Note: `getIntegration` already returns null when the row exists but
 * decryption fails (it logs the underlying error). Either case ends in the
 * same "no usable credentials" state for the caller.
 */
async function loadTokens(userId: number): Promise<StoredTokens | null> {
  const integration = getIntegration(userId, WHOOP_PROVIDER);
  if (!integration) return null;
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

function isExpired(tokens: StoredTokens, nowMs: number = Date.now()): boolean {
  const exp = Date.parse(tokens.expires_at);
  if (Number.isNaN(exp)) return true;
  return nowMs > exp - REFRESH_BUFFER_S * 1000;
}

async function refreshTokens(
  userId: number,
  current: StoredTokens
): Promise<StoredTokens | null> {
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
      `[token] refresh failed user_id=${userId} status=${resp.status} body=${JSON.stringify(bodyExcerpt)}`
    );
    // Flip flag only on definitive credential-rejection signals so a code
    // bug or upstream config issue doesn't train the user to reconnect.
    // Allowlist lives at module scope (REAUTH_ERROR_CODES); 401 catches
    // the RFC-canonical token-rejection case when no parsable error code
    // is present. 403 (scope/permission), 5xx, network, parse failure,
    // and unknown error codes → log only.
    //
    // Non-atomic with the upsert. Single-process Next.js serializes via
    // the per-user `inflightRefreshByUser` singleton, but a concurrent
    // Python sync (sync/daily_sync.py) could in theory race a flag-set
    // against a follow-up reset. Acceptable today; P2 keepalive will
    // reshape this.
    const errorCode =
      typeof bodyExcerpt.error === "string" ? bodyExcerpt.error : null;
    if (
      (errorCode && REAUTH_ERROR_CODES.has(errorCode)) ||
      resp.status === 401
    ) {
      setIntegrationNeedsReauth(userId, WHOOP_PROVIDER, true);
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
  await saveTokens(userId, stored);
  return stored;
}

export async function getValidAccessToken(
  userId: number,
  forceRefresh = false,
  hooks: { onRefresh?: () => void } = {},
): Promise<string | null> {
  const existing = inflightRefreshByUser.get(userId);
  if (existing) {
    return (await existing)?.access_token ?? null;
  }

  const tokens = await loadTokens(userId);
  if (!tokens) return null;
  if (!forceRefresh && !isExpired(tokens)) {
    return tokens.access_token;
  }

  // Re-check after the async gap above: a concurrent webhook may have started
  // a refresh between our loadTokens() await and here. Join it if so.
  const existingAfterLoad = inflightRefreshByUser.get(userId);
  if (existingAfterLoad) {
    return (await existingAfterLoad)?.access_token ?? null;
  }

  // Fire onRefresh only on the originating call — joiners above skip it so
  // a single refresh emits exactly one progress event.
  // INVARIANT: no awaits between this fire and the `inflightRefreshByUser`
  // assignment below. Single-thread JS guarantees no other caller can
  // observe an empty map entry between these two lines, which is what
  // prevents double-emit. Do NOT insert telemetry / logging here.
  hooks.onRefresh?.();
  const refreshPromise = refreshTokens(userId, tokens);
  const tracked = refreshPromise.finally(() => {
    inflightRefreshByUser.delete(userId);
  });
  inflightRefreshByUser.set(userId, tracked);
  const refreshed = await tracked;
  return refreshed?.access_token ?? null;
}
