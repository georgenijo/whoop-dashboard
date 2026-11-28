import { notFound } from "next/navigation";
import { createApiApp, isHonoApiEnabled } from "@/lib/api/app";

export const dynamic = "force-dynamic";

/**
 * Optional catch-all that mounts the Hono API (#233). Every concrete
 * `app/api/<name>/route.ts` outranks this file, so it only receives `/api`
 * paths no existing handler claims. Default-off: unless `COACH_HONO_API=1`,
 * it defers to Next's normal not-found handling.
 */
let app: ReturnType<typeof createApiApp> | null = null;

function handle(req: Request): Response | Promise<Response> {
  if (!isHonoApiEnabled()) notFound();
  app ??= createApiApp();
  return app.fetch(req);
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
