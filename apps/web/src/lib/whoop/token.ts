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
import { notifyWhoopNeedsReauth } from "@/lib/whoop/reauth-push";

// Post-Phase-D: the encrypted `integrations` row is the sole token store.
// The legacy `tokens.json` file fallback (#330) is gone. If the row is
// missing or undecryptable, callers see `null` and route to the reauth path.

const REFRESH_BUFFER_S = 60;
const WHOOP_PROVIDER = "whoop";

/**
 * Per-user in-flight refresh singletons. Keying on user_id (not a single
 * global) lets concurrent refreshes for distinct users proceed in parallel
 * while still serializing duplicates for the same user.
 *
 * Held on globalThis, NOT a module-level `new Map()` (#263). Next bundles
 * each route entry separately, so `/api/whoop/webhook`, `/api/sync`,
 * `/api/whoop/refresh` and the Coach's `trigger_whoop_sync` each got their
 * OWN copy of this module — and their own empty map. A webhook burst racing
 * a sync (or the keepalive) therefore sent the same single-use refresh token
 * to Whoop twice: one call rotated the chain, the other came back
 * `400 invalid_request` and flagged needs_reauth (or, if Whoop treats reuse
 * as theft, killed the whole chain). Same fix and rationale as the DB pool
 * in `@/lib/db/connection`.
 */
const INFLIGHT_KEY = Symbol.for("whoop-dashboard.whoop.inflight-refresh");

function inflightRefreshByUser(): Map<number, Promise<StoredTokens | null>> {
  const g = globalThis as unknown as Record<
    symbol,
    Map<number, Promise<StoredTokens | null>> | undefined
  >;
  let map = g[INFLIGHT_KEY];
  if (!map) {
    map = new Map();
    g[INFLIGHT_KEY] = map;
  }
  return map;
}

/**
 * Backoff between attempts for TRANSIENT refresh failures (network error,
 * timeout, 5xx, 429). Length = number of retries. Overridable in tests.
 */
let retryDelaysMs: readonly number[] = [500, 2_000];
/** Backoff between attempts to persist a freshly rotated pair. */
let saveRetryDelaysMs: readonly number[] = [50, 250];

/** @internal test hook — shrink backoffs so tests don't wait real seconds. */
export function __setRefreshRetryDelaysForTest(
  refresh: readonly number[],
  save: readonly number[] = refresh,
): void {
  retryDelaysMs = refresh;
  saveRetryDelaysMs = save;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type AttemptOutcome =
  | { kind: "ok"; data: Omit<StoredTokens, "expires_at"> }
  | { kind: "transient"; detail: string; retryable: boolean }
  | { kind: "rejected"; status: number; errorCode: string | null };

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

/** One POST to Whoop's token endpoint, classified. Never throws. */
async function attemptRefresh(
  userId: number,
  refreshToken: string,
): Promise<AttemptOutcome> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
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
    // A timeout already spent 15s; retrying it would hold every joined
    // caller (webhook handlers included) for up to ~45s more. Fail fast and
    // let the next flight try — it is ambiguous either way. Fast failures
    // (ECONNRESET, DNS, refused) are retried.
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      kind: "transient",
      detail: `network error: ${err instanceof Error ? err.message : String(err)}`,
      retryable: !timedOut,
    };
  }
  if (resp.ok) {
    try {
      const data = (await resp.json()) as Omit<StoredTokens, "expires_at">;
      if (typeof data?.access_token !== "string" || typeof data?.refresh_token !== "string") {
        return { kind: "transient", detail: "200 with malformed token body", retryable: true };
      }
      return { kind: "ok", data };
    } catch {
      return { kind: "transient", detail: "200 with unparseable body", retryable: true };
    }
  }
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
  // 5xx and 429 are Whoop-side / rate-limit trouble, not a verdict on the
  // token, so they're retried with the SAME refresh token. Usually Whoop
  // did not complete the grant and the retry just succeeds; if it did (5xx
  // after commit), the retry is rejected and the `ambiguous` guard in
  // refreshTokens keeps that from being mistaken for a dead chain.
  if (resp.status >= 500 || resp.status === 429) {
    return { kind: "transient", detail: `status=${resp.status}`, retryable: true };
  }
  return {
    kind: "rejected",
    status: resp.status,
    errorCode: typeof bodyExcerpt.error === "string" ? bodyExcerpt.error : null,
  };
}

/**
 * Persist a freshly rotated pair BEFORE anyone uses the new access token.
 *
 * Whoop has already retired the old refresh token by the time we get here,
 * so a failed write (SQLITE_BUSY under a concurrent writer, most likely)
 * would strand the chain: the DB keeps the dead token and the next refresh
 * is guaranteed to fail. Retry briefly; if it still fails, throw — the new
 * access token is NOT handed out, so nothing ever runs on credentials that
 * aren't on disk.
 */
async function persistRotated(userId: number, stored: StoredTokens): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      // saveTokens → upsertIntegration writes needs_reauth = 0 on every
      // successful write, so the flag self-resets here on a healthy refresh.
      await saveTokens(userId, stored);
      return;
    } catch (err) {
      const delay = saveRetryDelaysMs[attempt];
      if (delay === undefined) {
        console.error(
          `[token] CRITICAL: rotated whoop tokens could not be persisted user_id=${userId} attempts=${attempt + 1} err=${err instanceof Error ? err.message : String(err)} — chain is likely lost; reconnect will be required`
        );
        throw err;
      }
      await sleep(delay);
    }
  }
}

async function refreshTokens(
  userId: number,
  current: StoredTokens
): Promise<StoredTokens | null> {
  // `ambiguous` = an earlier attempt in THIS flight may have reached Whoop
  // and rotated the token even though we never saw the response (timeout,
  // dropped connection, 5xx after commit). A later rejection is then not
  // proof the chain is dead — it may just be our own lost rotation — so it
  // must not flip needs_reauth. The next flight re-presents the same stored
  // token; if that is rejected cleanly, it is flagged then.
  let ambiguous = false;
  let outcome: AttemptOutcome;
  for (let attempt = 0; ; attempt++) {
    outcome = await attemptRefresh(userId, current.refresh_token);
    if (outcome.kind !== "transient") break;
    ambiguous = true;
    const delay = outcome.retryable ? retryDelaysMs[attempt] : undefined;
    // Transient (timeout / network / 5xx). Log but do NOT flip needs_reauth
    // — a brief outage isn't a credential failure and a spurious banner
    // would train the user to ignore it.
    console.error(
      `[token] refresh transient failure user_id=${userId} attempt=${attempt + 1} ${outcome.detail}${delay === undefined ? " — giving up for now, not flagging needs_reauth" : ` — retrying in ${delay}ms`}`
    );
    if (delay === undefined) return null;
    await sleep(delay);
  }

  if (outcome.kind === "ok") {
    const stored: StoredTokens = {
      ...outcome.data,
      expires_at: computeExpiresAtIso(outcome.data.expires_in),
    };
    await persistRotated(userId, stored);
    return stored;
  }

  // Rejected. Before calling the chain dead, check whether someone else
  // (another process, or a module copy that predates the shared map)
  // rotated it while we were in flight: if the stored refresh token is no
  // longer the one we presented, our rejection is a lost race, not a dead
  // grant — use the winner's pair.
  const latest = await loadTokens(userId);
  if (latest && latest.refresh_token !== current.refresh_token) {
    console.warn(
      `[token] refresh lost a rotation race user_id=${userId} status=${outcome.status} — another caller already rotated the chain; using its tokens, not flagging needs_reauth`
    );
    return latest;
  }

  // Flip flag only on definitive credential-rejection signals so a code
  // bug or upstream config issue doesn't train the user to reconnect.
  //
  // Both sets are declared HERE, inside `refreshTokens`, on purpose. They
  // are only sound for the refresh_token grant, and module scope would let
  // any function added to this file later inherit them silently. Lexical
  // scope makes the "refresh grant only" claim structural instead of
  // aspirational — if you need this classification elsewhere, re-derive it
  // for that grant.
  //
  // invalid_request is reauth-worthy for THIS grant specifically. Per #263,
  // a genuinely dead/expired Whoop refresh token and a deliberately bogus
  // one both come back as `400 {"error":"invalid_request"}` with a
  // misleading redirect_uri `error_hint` — Whoop does not distinguish "your
  // token is dead" from "your request is malformed" here. That would
  // normally make invalid_request unsafe to treat as reauth-worthy, but this
  // request body (`grant_type`, `refresh_token`, `client_id`,
  // `client_secret`) is fully static/computed with no user-supplied input,
  // so in practice a 400 invalid_request can only mean the token was
  // rejected. Do NOT copy this to the authorization_code exchange
  // (`exchangeCode` in `@/lib/auth`) — that grant carries a user-supplied
  // `code`, so invalid_request there really can be our bug.
  const reauthErrorCodes = new Set([
    "invalid_grant",
    "invalid_token",
    "invalid_request",
  ]);
  // Never reauth-worthy, whatever the status: these mean OUR client
  // credentials are wrong (rotated/typo'd WHOOP_CLIENT_ID or SECRET), not
  // that the user's grant died. Reconnecting cannot help — `exchangeCode`
  // signs the authorization_code round-trip with the same credentials, so
  // the banner would send the user to a remedy that also fails. Whoop
  // answers bad credentials with `401 {"error":"invalid_client"}` (#263),
  // which is exactly why this has to be checked BEFORE the bare-401 branch
  // rather than documented as an exclusion the 401 branch then overrides.
  const configErrorCodes = new Set(["invalid_client", "unauthorized_client"]);

  const { errorCode, status } = outcome;
  if (errorCode && configErrorCodes.has(errorCode)) {
    // Log-only. Surfacing this as "reconnect Whoop" is worse than silence.
    console.error(
      `[token] refresh rejected our client credentials (${errorCode}) — check WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET; not flagging needs_reauth`
    );
  } else if (
    (errorCode && reauthErrorCodes.has(errorCode)) ||
    // Bare 401 with no parsable error code: the RFC-canonical
    // token-rejection status, and with invalid_client/unauthorized_client
    // already peeled off above, a dead grant is the likeliest remaining
    // cause. 403 (scope/permission), parse failure, and unknown error codes
    // → log only.
    status === 401
  ) {
    if (ambiguous) {
      console.error(
        `[token] refresh rejected after an ambiguous earlier attempt user_id=${userId} status=${status} error=${errorCode ?? "none"} — the lost attempt may have rotated the token; not flagging needs_reauth on this flight`
      );
    } else if (setIntegrationNeedsReauth(userId, WHOOP_PROVIDER, true)) {
      // Transition-only: an already-flagged row doesn't re-log or re-push.
      console.error(
        `[token] needs_reauth SET user_id=${userId} reason=${errorCode ?? `status_${status}`} — Whoop rejected the stored refresh token; user must reconnect`
      );
      // Push only on a real 0→1 transition (#287). Fire-and-forget: APNs
      // latency or failure must not hold up (or break) the refresh caller.
      void notifyWhoopNeedsReauth(userId);
    }
  }
  return null;
}

export async function getValidAccessToken(
  userId: number,
  forceRefresh = false,
  hooks: {
    onRefresh?: () => void;
    /**
     * The access token Whoop just answered 401 to. With `forceRefresh`, if
     * the stored token is already a DIFFERENT unexpired one, another caller
     * rotated the chain while our request was in flight — use that instead
     * of burning another rotation (#263: a webhook burst used to rotate
     * once per 401'd request).
     */
    rejectedAccessToken?: string;
  } = {},
): Promise<string | null> {
  const inflight = inflightRefreshByUser();
  const existing = inflight.get(userId);
  if (existing) {
    return (await existing)?.access_token ?? null;
  }

  const tokens = await loadTokens(userId);
  if (!tokens) return null;
  if (!forceRefresh && !isExpired(tokens)) {
    return tokens.access_token;
  }
  if (
    forceRefresh &&
    hooks.rejectedAccessToken !== undefined &&
    tokens.access_token !== hooks.rejectedAccessToken &&
    !isExpired(tokens)
  ) {
    return tokens.access_token;
  }

  // Re-check after the async gap above: a concurrent webhook may have started
  // a refresh between our loadTokens() await and here. Join it if so.
  const existingAfterLoad = inflight.get(userId);
  if (existingAfterLoad) {
    return (await existingAfterLoad)?.access_token ?? null;
  }

  // Fire onRefresh only on the originating call — joiners above skip it so
  // a single refresh emits exactly one progress event.
  // INVARIANT: no awaits between this fire and the `inflight.set` below. Single-thread JS guarantees no other caller can
  // observe an empty map entry between these two lines, which is what
  // prevents double-emit. Do NOT insert telemetry / logging here.
  hooks.onRefresh?.();
  const refreshPromise = refreshTokens(userId, tokens);
  const tracked = refreshPromise.finally(() => {
    // Only clear our own entry — never a newer flight's.
    if (inflight.get(userId) === tracked) inflight.delete(userId);
  });
  inflight.set(userId, tracked);
  const refreshed = await tracked;
  return refreshed?.access_token ?? null;
}
