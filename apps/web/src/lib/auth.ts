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
import { verifySessionToken } from "./auth/jwt";
import {
  CF_ACCESS_HEADER,
  CFAccessAuthError,
  verifyCFAccessJWT,
} from "./auth/cf-access";

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

export type StoredTokens = WhoopTokenResponse & { expires_at: number };

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
    expires_at: Date.now() / 1000 + data.expires_in,
  };
  await saveTokens(stored);
  return stored;
}

/** Atomic write (tmp + rename), matches streamlit/whoop/auth.py:69-73. */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const p = tokensPath();
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(tokens), "utf8");
  await fs.rename(tmp, p);
}

export type AuthSource = "web" | "ios" | "dev";

export type AuthResult = {
  user: User;
  source: AuthSource;
};

// Precedence: Bearer > CF Access > dev bootstrap. Don't flip without auditing all routes.
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
