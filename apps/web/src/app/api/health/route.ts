// Build-identity probe. Exists so a deploy can be *verified* rather than
// assumed: `scripts/deploy` polls this after restarting the service and fails
// loudly if the running build is not the commit it just pushed. Prod silently
// ran three commits behind main for a day (the fix for a live coach-timeout
// bug was merged and undeployed) precisely because nothing reported what was
// actually running.
//
// Auth-exempt (see AUTH_EXEMPT_PREFIXES in proxy.ts) so the check works before
// and without a session.
//
// The build sha is withheld from off-box callers. This repo is PUBLIC, so a
// running sha lets an anonymous caller diff against main and enumerate
// merged-but-undeployed commits — i.e. read off the exact window during which
// a known fix is not yet live. `scripts/deploy` verifies from opti against
// localhost:8501, so it never needs the sha to be public.
//
// Discriminator: the VALUE of x-forwarded-for, not its presence. Next 16.2.4
// SYNTHESIZES x-forwarded-for/-host/-port/-proto on every request, so a direct
// `curl localhost:8501` still arrives carrying `x-forwarded-for: ::1` —
// verified empirically against this exact Next version. Testing for the
// absence of those headers therefore never matches and would silently strip
// the sha from the deploy check itself.
//
// Cloudflare Tunnel forwards the real client IP, so a request from the public
// edge does not have loopback as the FIRST entry. Only an on-box request has a
// loopback address there. Fail closed: anything unrecognised gets bare status.
//
// THIS IS DEFENCE IN DEPTH, NOT A SECURITY BOUNDARY. Headers are attacker
// controlled. Production binds next-server to 127.0.0.1:8501 and the protected
// value is only a commit sha of a PUBLIC repo. Do not extend this predicate to
// gate anything that actually matters.
import { BUILD_SHA, BUILD_TIME } from "@/lib/build-info";

export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();
const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost"]);

function isDirectOnBoxCall(req: Request): boolean {
  // A proxied request also carries X-Real-IP; a synthesized one never does.
  if (req.headers.get("x-real-ip")) return false;
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return true;
  const origin = xff.split(",")[0]?.trim().toLowerCase() ?? "";
  return LOOPBACK.has(origin);
}

export function GET(req: Request) {
  if (!isDirectOnBoxCall(req)) {
    return Response.json({ status: "ok" });
  }
  return Response.json({
    status: "ok",
    sha: BUILD_SHA,
    built_at: BUILD_TIME,
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}
