import { secretMatches } from "@/lib/auth/secret-compare";
import { runSharedKeyProbe } from "@/lib/coach/shared-key-probe";
import { listIntegrationUserIds } from "@/lib/db/integrations";
import { addSyncLog, KEEPALIVE_SYNC_SOURCE } from "@/lib/db/logs";
import { forModule } from "@/lib/logger";
import { getValidAccessToken } from "@/lib/whoop/token";

// Background refresh-only keepalive (#273, resolving the two open decisions
// from the #263 audit comment, 2026-08-17). A systemd timer on the deploy
// box (systemd/whoop-web-refresh.{service,timer}) hits this every 30
// minutes so Whoop's ~3h idle refresh-token TTL never lapses between a real
// sync/webhook/Coach action. This route does ONE thing: force-refresh every
// active tenant's Whoop token via the already-hardened `getValidAccessToken`
// path in `@/lib/whoop/token`. No sync, no Whoop resource pulls, no domain
// (recovery/cycles/sleep/workouts/daily_summary) table reads/writes —
// `needs_reauth` reset-on-success and flip-on-failure both happen inside
// that existing path (`upsertIntegration` / `setIntegrationNeedsReauth`),
// not duplicated here. It does write one `sync_logs` row per attempted
// user (source="keepalive") — that table is infra/observability, not a
// domain table, and it's how a dead chain becomes visible on /logs instead
// of only in journald.
export const dynamic = "force-dynamic";

const log = forModule("whoop.refresh");

const WHOOP_PROVIDER = "whoop";

// Floor between real refresh attempts, independent of the 30-minute timer
// cadence. Not a rate limiter in the request-count sense — the route is
// already behind a secret only the timer (or an operator) holds — but a
// misfiring timer, a retried curl, or a manual double-invoke must not
// amplify into repeated Whoop token-endpoint hits. Set BEFORE the fan-out
// starts (not after it completes), so a run that errors out immediately
// still burns the floor rather than being retriable in a hot loop — this is
// a cheap-and-non-amplifying guard, not retry/backoff logic.
const MIN_INTERVAL_MS = 60_000;
let lastRunAt = 0;

function extractBearer(authz: string | null): string | null {
  if (!authz) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authz);
  return match ? match[1] : null;
}

type UserResult = { user_id: number; ok: boolean };

/**
 * Force-refresh one tenant's token and persist the outcome. Never rejects —
 * every branch (including the unexpected-throw branch) resolves a
 * `UserResult`, which is what lets the caller use a plain `Promise.all`
 * instead of `Promise.allSettled` for the fan-out.
 */
async function refreshOne(userId: number): Promise<UserResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let ok = false;
  let errorMessage: string | null = null;
  try {
    const token = await getValidAccessToken(userId, true);
    ok = token !== null;
    if (!ok) {
      errorMessage =
        "refresh rejected or unavailable (see [token] logs for upstream status/body)";
    }
  } catch (err) {
    // getValidAccessToken/refreshTokens do not normally throw — the network
    // and upstream-error branches inside refreshTokens (token.ts) return
    // null and log internally. But `saveTokens` on the success path runs
    // AFTER Whoop has already rotated the refresh token server-side; if
    // that write throws (SQLITE_BUSY, VaultMissingKeyError,
    // IntegrationUserMissingError), the new pair is lost and the old one is
    // already dead. That failure surfaces here as a thrown rejection rather
    // than a clean `null`. Log it loudly — this is exactly the class of
    // failure #273 exists to make visible, and at 30-minute cadence it can
    // now happen up to 48x/day per tenant instead of only on the next
    // real sync attempt — and never let it abort another tenant's refresh.
    errorMessage = err instanceof Error ? err.message : String(err);
    log.error(
      { user_id: userId, err: errorMessage },
      "unexpected error refreshing whoop token"
    );
  }
  addSyncLog({
    user_id: userId,
    started_at: startedAt,
    duration_ms: Date.now() - t0,
    status: ok ? "ok" : "error",
    // Not a data sync — no rows fetched. Rendered as "-" in the Sync
    // History table (SyncLogsTable.tsx already handles null counts).
    recovery_count: null,
    sleep_count: null,
    workouts_count: null,
    error_message: ok ? null : errorMessage,
    source: KEEPALIVE_SYNC_SOURCE,
    details: null,
    partial: false,
  });
  return { user_id: userId, ok };
}

export async function POST(req: Request) {
  // Fail closed: unset/empty secret means the operator hasn't provisioned
  // this yet. The *shape* is deliberately different from the ADMIN_APPLE_SUB
  // gate (apps/web/src/app/api/admin/webhook/replay/route.ts), not a copy of
  // it — that route requires a signed-in session first and then returns 500
  // (unconfigured) or 403 (wrong admin), because a human is already
  // authenticated by the time it runs. This route has no session at all (a
  // systemd timer holds only the bearer secret), so it fails closed at 404
  // for both "route not configured" and "wrong secret" — see the 401 branch
  // below, which intentionally does NOT disclose more than that.
  const secret = process.env.WHOOP_REFRESH_SECRET;
  if (!secret) {
    return new Response("Not found", { status: 404 });
  }

  // NOTE: an unset secret answers 404 and a configured-but-wrong secret
  // answers 401 — a caller that can distinguish those two responses learns
  // whether the route is provisioned at all. That's a narrower disclosure
  // than "the route exists" (still requires guessing the exact path), and
  // is the same tradeoff any bearer-gated route with a "not configured"
  // state has to make; it is not the stronger "route's existence is never
  // disclosed" claim.
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

  // Users already flagged needs_reauth are known-dead — another refresh
  // attempt can't clear that flag (only a user-driven reconnect can), so
  // skip them rather than sending 48 guaranteed-to-fail Whoop POSTs/day per
  // dead tenant.
  const userIds = listIntegrationUserIds(WHOOP_PROVIDER, { activeOnly: true });

  // #525: the same timer tick also probes the shared CURSOR_API_KEY (no-op
  // unless COACH_KEY_PROBE=on). Runs concurrently so it never extends the
  // timer's 25s curl budget beyond the probe's own 10s catalog timeout, and
  // never rejects. Its result is reported in the body but deliberately does
  // NOT feed the 200/502 status below — that status means "Whoop refresh
  // chain healthy", and the probe's state lives in credential_health.
  const [users, keyProbe] = await Promise.all([
    Promise.all(userIds.map(refreshOne)),
    runSharedKeyProbe().catch(() => ({ ran: false as const, reason: "error" as const })),
  ]);

  const refreshed = users.filter((u) => u.ok).length;
  const failed = users.length - refreshed;
  const healthy = failed === 0 && users.length > 0;

  if (healthy) {
    log.info(
      { total: users.length, refreshed },
      "keepalive refreshed all active whoop integrations"
    );
  } else {
    log.error(
      {
        total: users.length,
        refreshed,
        failed,
        failed_user_ids: users.filter((u) => !u.ok).map((u) => u.user_id),
      },
      users.length === 0
        ? "keepalive ran with no active whoop integrations to refresh"
        : "keepalive completed with at least one failed refresh"
    );
  }

  // Non-200 whenever something is actually wrong (a real refresh failure, or
  // nothing active to refresh at all), so `curl --fail` — and therefore the
  // systemd unit / `systemctl --failed` — surfaces it instead of reporting
  // success 48x/day while a dead integration silently rots. That silent
  // "OK" response is verbatim the bug #273 exists to prevent.
  return Response.json(
    {
      ok: healthy,
      total: users.length,
      refreshed,
      failed,
      users,
      key_probe: keyProbe.ran
        ? { status: keyProbe.status, incident: keyProbe.incident }
        : { status: "skipped", reason: keyProbe.reason },
    },
    { status: healthy ? 200 : 502 }
  );
}
