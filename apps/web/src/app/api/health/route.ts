// Unauthenticated build-identity probe. Exists so a deploy can be *verified*
// rather than assumed: `scripts/deploy` polls this after restarting the
// service and fails loudly if the running build is not the commit it just
// pushed. Prod silently ran three commits behind main for a day (the fix for
// a live coach-timeout bug was merged and undeployed) precisely because
// nothing reported what was actually running.
//
// Deliberately returns no secrets and no per-user data — it is in
// `AUTH_EXEMPT_PREFIXES` so the check works before/without a session.
import { BUILD_SHA, BUILD_TIME } from "@/lib/build-info";

export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();

export function GET() {
  return Response.json({
    status: "ok",
    sha: BUILD_SHA,
    built_at: BUILD_TIME,
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}
