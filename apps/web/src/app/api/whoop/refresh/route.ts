import crypto from "node:crypto";
import { listIntegrationUserIds } from "@/lib/db/integrations";
import { getValidAccessToken } from "@/lib/whoop/token";

// Background refresh-only keepalive (#273, resolving the two open decisions
// from the #263 audit comment, 2026-08-17). A systemd timer on the deploy
// box (systemd/whoop-web-refresh.{service,timer}) hits this every 30
// minutes so Whoop's ~3h idle refresh-token TTL never lapses between a real
// sync/webhook/Coach action. This route does ONE thing: force-refresh every
// tenant's Whoop token via the already-hardened `getValidAccessToken`
// path in `@/lib/whoop/token`. No sync, no Whoop resource pulls, no domain
// table reads/writes — `needs_reauth` reset-on-success and
// flip-on-failure both happen inside that existing path (`upsertIntegration`
// / `setIntegrationNeedsReauth`), not duplicated here.
export const dynamic = "force-dynamic";

const WHOOP_PROVIDER = "whoop";

// Floor between real refresh attempts, independent of the 30-minute timer
// cadence. Not a rate limiter in the request-count sense — the route is
// already behind a secret only the timer (or an operator) holds — but a
// misfiring timer, a retried curl, or a manual double-invoke must not
// amplify into repeated Whoop token-endpoint hits. Any call inside the
// floor is answered without touching Whoop or the DB.
const MIN_INTERVAL_MS = 60_000;
let lastRunAt = 0;

/**
 * Constant-time bearer-secret compare. Mirrors the length-guard +
 * `crypto.timingSafeEqual` shape already used for Whoop webhook signatures
 * (`apps/web/src/lib/whoop/signature.ts`) rather than a plain `===`, which
 * short-circuits on the first mismatched byte and leaks timing information
 * about how much of the secret the caller got right.
 *
 * Exported for test coverage that proves this doesn't degrade to `===`.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on unequal-length buffers rather than returning
  // false — guard it explicitly. This branch does leak the correct
  // secret's length, not its content, which is the same tradeoff every
  // constant-time-compare-of-strings implementation makes (see
  // signature.ts's identical guard).
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function extractBearer(authz: string | null): string | null {
  if (!authz) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authz);
  return match ? match[1] : null;
}

type UserResult = { user_id: number; ok: boolean };

async function refreshOne(userId: number): Promise<UserResult> {
  try {
    const token = await getValidAccessToken(userId, true);
    return { user_id: userId, ok: token !== null };
  } catch (err) {
    // getValidAccessToken/refreshTokens do not normally throw (network and
    // upstream-error branches return null), but one tenant's unexpected
    // failure — e.g. a DB hiccup — must never abort the others.
    console.error(
      `[whoop-refresh] unexpected error refreshing user_id=${userId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { user_id: userId, ok: false };
  }
}

export async function POST(req: Request) {
  // Fail closed: unset/empty secret means the operator hasn't provisioned
  // this yet. Same shape as the ADMIN_APPLE_SUB gate (see
  // apps/web/src/app/api/admin/webhook/replay/route.ts) — 404, not 401/403,
  // so the route's very existence isn't disclosed to a caller that doesn't
  // already hold the secret.
  const secret = process.env.WHOOP_REFRESH_SECRET;
  if (!secret) {
    return new Response("Not found", { status: 404 });
  }

  const provided = extractBearer(req.headers.get("authorization"));
  if (!provided || !secretMatches(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  if (now - lastRunAt < MIN_INTERVAL_MS) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "cooldown",
    });
  }
  lastRunAt = now;

  const userIds = listIntegrationUserIds(WHOOP_PROVIDER);
  const settled = await Promise.allSettled(userIds.map(refreshOne));

  const users: UserResult[] = settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : { user_id: userIds[i], ok: false }
  );
  const refreshed = users.filter((u) => u.ok).length;
  const failed = users.length - refreshed;

  console.log(
    `[whoop-refresh] total=${users.length} refreshed=${refreshed} failed=${failed}` +
      (failed > 0
        ? ` failed_user_ids=${users.filter((u) => !u.ok).map((u) => u.user_id).join(",")}`
        : "")
  );

  return Response.json({
    ok: true,
    total: users.length,
    refreshed,
    failed,
    users,
  });
}
