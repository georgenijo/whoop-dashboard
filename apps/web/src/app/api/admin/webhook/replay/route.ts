import { requireAuth } from "@/lib/auth";
import {
  bumpWebhookAttempt,
  getWebhookEvent,
  listFailedWebhookEvents,
  markWebhookDiscarded,
  markWebhookFailed,
  markWebhookSucceeded,
  type WebhookEventRow,
} from "@/lib/db";
import { WhoopNotFoundError } from "@/lib/whoop/client";
import { handleEvent, type WhoopWebhookEvent } from "@/lib/whoop/webhook-handler";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ReplayError = { id: number; message: string };

type ReplayResult = {
  replayed: number;
  succeeded: number;
  failed: number;
  discarded: number;
  errors: ReplayError[];
};

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

async function replayOne(row: WebhookEventRow): Promise<{
  outcome: "succeeded" | "failed" | "discarded";
  error?: string;
}> {
  const attemptedAt = new Date().toISOString();
  bumpWebhookAttempt(row.id, attemptedAt);

  let evt: WhoopWebhookEvent;
  try {
    evt = JSON.parse(row.payload) as WhoopWebhookEvent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markWebhookFailed(row.id, `replay: malformed payload: ${msg}`, attemptedAt);
    return { outcome: "failed", error: msg };
  }

  try {
    await handleEvent(evt);
    markWebhookSucceeded(row.id, new Date().toISOString());
    return { outcome: "succeeded" };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    if (err instanceof WhoopNotFoundError) {
      markWebhookDiscarded(row.id, finishedAt);
      return { outcome: "discarded" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    markWebhookFailed(row.id, msg, finishedAt);
    return { outcome: "failed", error: msg };
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuth(req);

    const adminSub = process.env.ADMIN_APPLE_SUB;
    if (!adminSub) {
      return new Response("ADMIN_APPLE_SUB not configured", { status: 500 });
    }
    if (user.apple_sub !== adminSub) {
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(req.url);
    const idParam = url.searchParams.get("id");
    const status = url.searchParams.get("status");
    const limit = parseLimit(url.searchParams.get("limit"));

    let rows: WebhookEventRow[];
    if (idParam) {
      const id = Number.parseInt(idParam, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return new Response("Bad id", { status: 400 });
      }
      const row = getWebhookEvent(id);
      if (!row) return new Response("Not found", { status: 404 });
      rows = [row];
    } else if (status === "failed") {
      rows = listFailedWebhookEvents(limit);
    } else {
      return new Response(
        "Provide ?id=<n> or ?status=failed[&limit=<n>]",
        { status: 400 }
      );
    }

    const result: ReplayResult = {
      replayed: 0,
      succeeded: 0,
      failed: 0,
      discarded: 0,
      errors: [],
    };

    for (const row of rows) {
      result.replayed += 1;
      const r = await replayOne(row);
      if (r.outcome === "succeeded") result.succeeded += 1;
      else if (r.outcome === "discarded") result.discarded += 1;
      else {
        result.failed += 1;
        result.errors.push({ id: row.id, message: r.error ?? "unknown" });
      }
    }

    return Response.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
