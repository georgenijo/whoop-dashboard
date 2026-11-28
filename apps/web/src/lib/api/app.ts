import "server-only";

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { requireAuth, type AuthResult } from "@/lib/auth";
import {
  buildDashboardToday,
  INVALID_DATE_MESSAGE,
  resolveRequestedDate,
} from "@/lib/dashboard/today";
import {
  DashboardTodayQuerySchema,
  DashboardTodayResponseSchema,
  ErrorResponseSchema,
} from "@/lib/api/schemas/dashboard-today";

/**
 * Hono API surface (#233 phase 1) — a parallel, default-off mount.
 *
 * Mounted by `app/api/[[...rest]]/route.ts`. Next resolves every existing
 * `app/api/<name>/route.ts` file BEFORE the optional catch-all, so while the
 * old route files exist, this app only ever sees paths no Next route claims.
 * Cutting a route over is therefore "delete its Next route file" — and that
 * is George's call, not this PR's.
 *
 * Gated by `COACH_HONO_API=1` (see `isHonoApiEnabled`); unset, the catch-all
 * answers exactly like an unmatched path does today.
 */

type ApiEnv = { Variables: { auth: AuthResult } };

/**
 * `requireAuth` as Hono middleware. Same precedence and same 401 bodies as
 * the per-route handlers (Bearer → Cookie → 401): `requireAuth` throws a
 * `Response`, which we return verbatim.
 */
export const authMiddleware = createMiddleware<ApiEnv>(async (c, next) => {
  try {
    c.set("auth", await requireAuth(c.req.raw));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  await next();
});

const dashboardTodayRoute = createRoute({
  method: "get",
  path: "/dashboard/today",
  tags: ["Dashboard"],
  summary: "Today's recovery, sleep, strain and health signals",
  description:
    "Returns the requested day, or — when it has no data — the most recent day in the prior 7 days (is_fallback=true).",
  middleware: [authMiddleware],
  request: { query: DashboardTodayQuerySchema },
  responses: {
    200: {
      description: "Dashboard snapshot",
      content: { "application/json": { schema: DashboardTodayResponseSchema } },
    },
    400: {
      description: "Malformed date",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: { description: "Missing or invalid credentials" },
  },
});

export function createApiApp() {
  const app = new OpenAPIHono<ApiEnv>({
    // Zod query failures answer with the same body the Next route uses.
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: INVALID_DATE_MESSAGE }, 400);
    },
  }).basePath("/api");

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Session JWT (iOS).",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "__Host-coach_session",
    description: "Web session cookie set by Sign in with Apple.",
  });

  app.openapi(dashboardTodayRoute, (c) => {
    const { user } = c.get("auth");
    const date = resolveRequestedDate(c.req.valid("query").date);
    if (!date) return c.json({ error: INVALID_DATE_MESSAGE }, 400);
    const body = DashboardTodayResponseSchema.parse(buildDashboardToday(user.id, date));
    return c.json(body, 200);
  });

  // Draft spec, authenticated like every other route here. The proxy gate
  // only checks that a cookie/bearer is *present*, so the real check has to
  // happen in-app. Publishing it unauthenticated (for Scalar on coach-api.*)
  // is a later, explicit policy change — it is NOT in AUTH_EXEMPT_PREFIXES.
  app.use("/openapi.json", authMiddleware);
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    // Document-level: every route here requires auth. (A per-route
    // `security` field defeats @hono/zod-openapi's input type inference.)
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    info: {
      title: "Coach API (draft)",
      version: "0.1.0",
      description:
        "Partial: covers only routes migrated to Hono (#233). Existing Next route handlers are not listed yet.",
    },
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}

export function isHonoApiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.COACH_HONO_API === "1";
}
