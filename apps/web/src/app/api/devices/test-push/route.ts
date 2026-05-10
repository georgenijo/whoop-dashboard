import { requireAuth } from "@/lib/auth";
import { listDeviceTokensForUser } from "@/lib/db/devices";
import { sendAlertToToken } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Debug-only push sender. Sends a fixed test alert to every APNs token
 * registered under the authenticated user. Disabled in production unless
 * `ENABLE_PUSH_DEBUG=1` — when disabled, returns 404 (not 403) so the
 * endpoint's existence isn't advertised to unauthenticated probes.
 *
 * This route is the verification harness for #274a (foundation). Real
 * push sends from feature paths (#274b) call sendAlertToToken directly,
 * not via this endpoint.
 */
function isDebugEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ENABLE_PUSH_DEBUG === "1";
}

export async function POST(req: Request) {
  if (!isDebugEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  let user: { id: number };
  try {
    ({ user } = await requireAuth(req));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const tokens = listDeviceTokensForUser(user.id);
  if (tokens.length === 0) {
    return Response.json(
      { ok: false, error: "no_tokens_registered" },
      { status: 404 }
    );
  }

  const results = await Promise.all(
    tokens.map(async (row) => {
      try {
        const r = await sendAlertToToken(row.token, {
          title: "Coach",
          body: "Push test from Coach",
        });
        return {
          token: row.token,
          ok: r.ok,
          status: r.ok ? 200 : r.status,
          reason: r.ok ? null : r.reason,
        };
      } catch (err) {
        return {
          token: row.token,
          ok: false,
          status: 0,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return Response.json({ ok: true, results });
}
