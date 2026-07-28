// Build identity, resolved once at build time by next.config.ts and inlined
// as literals. Read this rather than `process.env` directly so there is a
// single place that defines what "unknown" looks like.
//
// COACH_BUILD_SHA / COACH_BUILD_TIME are set in next.config.ts; the fallback
// only shows up if someone runs the server without a build step.
export const BUILD_SHA = process.env.COACH_BUILD_SHA || "unknown";
export const BUILD_TIME = process.env.COACH_BUILD_TIME || "unknown";
