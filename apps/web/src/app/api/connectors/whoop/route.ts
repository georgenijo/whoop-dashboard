import { NextResponse } from "next/server";
import { getIntegration } from "@/lib/db/integrations";
import { getLastSuccessfulSyncAt } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WHOOP_PROVIDER = "whoop";
const REFRESH_BUFFER_MS = 60 * 1000;

export type WhoopConnectorStatus =
  | "connected"
  | "needs_reconnect"
  | "disconnected";

type ConnectorResponse = {
  provider: "whoop";
  status: WhoopConnectorStatus;
  expires_at: string | null;
  scope: string | null;
  source: "db" | null;
  last_sync_at: string | null;
};

function expiresAtFromIso(iso: string | null): {
  expired: boolean;
  expires_at: string | null;
} {
  if (!iso) return { expired: true, expires_at: null };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { expired: true, expires_at: iso };
  return { expired: t - REFRESH_BUFFER_MS < Date.now(), expires_at: iso };
}

/**
 * GET /api/connectors/whoop — Settings UI status card.
 *
 * Status semantics:
 *   - `connected`: integrations row decrypts cleanly AND not expired AND
 *     not flagged for reauth.
 *   - `needs_reconnect`: a row exists but the refresh chain has died —
 *     either expires_at has passed, OR Whoop's token endpoint returned a
 *     definitive credential-rejection (invalid_grant / invalid_token /
 *     401) and the refresh path flipped `needs_reauth=1`. The flag catches
 *     the silent-invalidation case from #263 where Whoop kills the refresh
 *     server-side BEFORE expires_at — clock check alone misses that window.
 *   - `disconnected`: no integrations row for this user.
 *
 * Post-Phase-D: the encrypted integrations row is the sole source of truth.
 * The legacy `tokens.json` file fallback was removed in #330/#313.
 */
export async function GET(req: Request) {
  // Per-user lookup. Today single-user (auth.user.id is almost always 1),
  // but the whole point of the SIWA unification is that integrations
  // belong to a resolved user — never hardcode the bootstrap id here.
  const auth = await requireAuth(req);

  const integration = getIntegration(auth.user.id, WHOOP_PROVIDER);
  let status: WhoopConnectorStatus = "disconnected";
  let expiresAt: string | null = null;
  let scope: string | null = null;
  let source: "db" | null = null;

  if (integration) {
    source = "db";
    scope = integration.scope ?? null;
    const checked = expiresAtFromIso(integration.expires_at);
    expiresAt = checked.expires_at;
    status =
      integration.needs_reauth || checked.expired
        ? "needs_reconnect"
        : "connected";
  }

  const last = getLastSuccessfulSyncAt(auth.user.id);

  const body: ConnectorResponse = {
    provider: "whoop",
    status,
    expires_at: expiresAt,
    scope,
    source,
    last_sync_at: last ? last.toISOString() : null,
  };
  return NextResponse.json(body);
}
