import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

// Stamp the build with the commit it came from so `/api/health` can report
// what is actually running. Resolved here (build time), never at request time.
// An explicit COACH_BUILD_SHA wins so a build without a .git dir can still
// supply it.
function resolveBuildSha(): string {
  if (process.env.COACH_BUILD_SHA) return process.env.COACH_BUILD_SHA;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const allowedDevOrigins = process.env.COACH_DEV_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins,
  experimental: {
    proxyClientMaxBodySize: "30mb",
  },
  env: {
    COACH_BUILD_SHA: resolveBuildSha(),
    COACH_BUILD_TIME: new Date().toISOString(),
  },
  // Issue #501. These are the STATIC security headers — they must live here
  // rather than in `src/proxy.ts` because the proxy matcher deliberately
  // excludes `/_next/static` and `/_next/image`, and `nosniff` on the static
  // asset responses is exactly where it matters most. The per-request,
  // nonce-bearing Content-Security-Policy-Report-Only is set in the proxy.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders(process.env.NODE_ENV === "development"),
      },
    ];
  },
};

export default nextConfig;
