import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  devIndicators: false,
  env: {
    COACH_BUILD_SHA: resolveBuildSha(),
    COACH_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
