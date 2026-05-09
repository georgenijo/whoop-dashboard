import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  findOrCreateUserByEmail,
  getPrimaryUser,
  getSessionByToken,
  getUserById,
  type User,
} from "./db";
import { upsertIntegration } from "./db/integrations";
import { verifySessionToken } from "./auth/jwt";
import {
  CF_ACCESS_HEADER,
  CFAccessAuthError,
  verifyCFAccessJWT,
} from "./auth/cf-access";
import { COACH_SESSION_COOKIE } from "./auth/cookies";

export const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const WHOOP_SCOPES =
  "offline read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement";

export function clientId(): string {
  const v = process.env.WHOOP_CLIENT_ID;
  if (!v) throw new Error("WHOOP_CLIENT_ID not configured");
  return v;
}

export function clientSecret(): string {
  const v = process.env.WHOOP_CLIENT_SECRET;
  if (!v) throw new Error("WHOOP_CLIENT_SECRET not configured");
  return v;
}

export function redirectUri(): string {
  return (
    process.env.WHOOP_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback"
  );
}

export function tokensPath(): string {
  if (process.env.WHOOP_TOKENS_PATH) return process.env.WHOOP_TOKENS_PATH;
  // Default: repo-root `tokens.json` (matches streamlit/whoop/auth.py:17).
  // process.cwd() is `apps/web/`, so repo root is two levels up.
  return path.resolve(process.cwd(), "..", "..", "tokens.json");
}

export function getBootstrapUser(): User {
  const user = getPrimaryUser();
  if (!user) {
    throw new Response("Single-user bootstrap missing", { status: 500 });
  }
  return user;
}

export function buildAuthUrl(): string {
  const state = crypto.randomBytes(8).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: WHOOP_SCOPES,
    state,
  });
  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

/**
 * Persisted Whoop tokens. `expires_at` is an ISO 8601 string (UTC), matching
 * the integrations row + streamlit/whoop/auth.py. Numeric epoch is no longer
 * supported anywhere — `isExpired` and friends parse the string directly.
 */
export type StoredTokens = Omit<WhoopTokenResponse, never> & {
  expires_at: string;
};

const DEFAULT_USER_ID = 1;
const WHOOP_PROVIDER = "whoop";

/** Compute ISO 8601 expires_at from Whoop's `expires_in` (seconds). */
export function computeExpiresAtIso(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

export async function exchangeCode(code: string): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const resp = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as WhoopTokenResponse;
  const stored: StoredTokens = {
    ...data,
    expires_at: computeExpiresAtIso(data.expires_in),
  };
  await saveTokens(stored);
  return stored;
}

/**
 * Persist Whoop tokens.
 *
 * Dual-write:
 *   1. Encrypted `integrations` row (primary). The `raw` column is UNENCRYPTED
 *      JSON, so we MUST NEVER pass credential fields (access_token /
 *      refresh_token) into it — that would defeat the vault. Today nothing
 *      else needs `raw`, so we always pass `raw=undefined`. If we later need
 *      to persist non-credential metadata, add a tight allowlist or a
 *      separately-encrypted column.
 *   2. Atomic tmp+rename to `tokens.json` (parallel — file is the recovery
 *      anchor; never delete from this layer). Matches Python save_tokens.
 *
 * Error handling: each write is logged on individual failure so the other can
 * still serve as a persistent copy. If BOTH writes fail, we throw so the
 * caller doesn't proceed assuming tokens were saved.
 */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  let dbOk = false;
  let fileOk = false;
  let dbErr: unknown;
  let fileErr: unknown;

  // 1) Encrypted DB write. `raw=undefined` — see docstring above.
  try {
    upsertIntegration({
      user_id: DEFAULT_USER_ID,
      provider: WHOOP_PROVIDER,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      scope: tokens.scope ?? null,
      token_type: tokens.token_type ?? null,
      raw: undefined,
    });
    dbOk = true;
  } catch (err) {
    dbErr = err;
    console.error(
      `[auth] integrations upsert failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 2) Parallel write to tokens.json (atomic tmp+rename), matches
  // streamlit/whoop/auth.py save_tokens.
  try {
    const p = tokensPath();
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens), "utf8");
    await fs.rename(tmp, p);
    fileOk = true;
  } catch (err) {
    fileErr = err;
    console.error(
      `[auth] tokens.json write failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!dbOk && !fileOk) {
    const dbMsg =
      dbErr instanceof Error ? dbErr.message : String(dbErr ?? "unknown");
    const fileMsg =
      fileErr instanceof Error ? fileErr.message : String(fileErr ?? "unknown");
    throw new Error(
      `saveTokens: both writes failed (db: ${dbMsg}; file: ${fileMsg})`
    );
  }
}

export type AuthSource = "web" | "ios" | "dev";

export type AuthResult = {
  user: User;
  source: AuthSource;
};

/**
 * Look up a single cookie value out of a `Cookie:` header. Hand-rolled to
 * keep `requireAuth` dependency-free at the edge — the standard library
 * doesn't expose a cookie parser. RFC 6265 says values can't contain commas
 * or semicolons, so a naive split-on-`;` is sufficient here.
 */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return part.slice(idx + 1).trim();
  }
  return null;
}

// Precedence: Bearer > Cookie > CF Access > dev bootstrap. Don't flip without auditing all routes.
export async function requireAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get("authorization");

  if (header) {
    const bearerMatch = header.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
      const token = bearerMatch[1].trim();
      const claims = await verifySessionToken(token);
      if (claims) {
        const user = getUserById(claims.userId);
        if (!user) throw new Response("User not found", { status: 401 });
        return { user, source: "ios" };
      }

      const session = getSessionByToken(token);
      if (session) {
        if (new Date(session.expires_at) < new Date()) {
          throw new Response("Expired token", { status: 401 });
        }
        const user = getUserById(session.user_id);
        if (!user) throw new Response("User not found", { status: 401 });
        return { user, source: "ios" };
      }

      throw new Response("Invalid token", { status: 401 });
    }
    throw new Response("Invalid token", { status: 401 });
  }

  // Cookie auth (web). Only the `__Host-coach_session` cookie is recognised
  // — issued by /api/auth/apple-web/callback after a verified SIWA round-trip.
  const cookieHeader = req.headers.get("cookie");
  const sessionCookie = readCookie(cookieHeader, COACH_SESSION_COOKIE);
  if (sessionCookie) {
    const claims = await verifySessionToken(sessionCookie);
    if (claims) {
      const user = getUserById(claims.userId);
      if (!user) throw new Response("User not found", { status: 401 });
      return { user, source: "web" };
    }
    // An invalid/expired cookie shouldn't lock the user out if CF Access
    // can vouch for them — fall through to the next layer rather than 401.
  }

  const cfAssertion = req.headers.get(CF_ACCESS_HEADER);
  if (cfAssertion) {
    let identity: { email: string };
    try {
      identity = await verifyCFAccessJWT(cfAssertion);
    } catch (err) {
      if (err instanceof CFAccessAuthError) {
        throw new Response("Invalid CF Access token", { status: 401 });
      }
      throw err;
    }
    return { user: findOrCreateUserByEmail(identity.email), source: "web" };
  }

  if (process.env.NODE_ENV !== "production") {
    return { user: getBootstrapUser(), source: "dev" };
  }

  throw new Response("Unauthorized", { status: 401 });
}
