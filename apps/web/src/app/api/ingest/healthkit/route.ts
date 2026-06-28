import { requireAuth } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { ingestHealthKitWorkouts } from "@/lib/healthkit/ingest";

export const dynamic = "force-dynamic";

// Defensive cap — an iOS backfill batches recent workouts, never thousands.
const MAX_BATCH = 500;

type IngestBody = {
  workouts?: unknown;
};

export async function POST(req: Request) {
  let user: { id: number };
  try {
    ({ user } = await requireAuth(req));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!Array.isArray(body.workouts)) {
    return Response.json({ error: "workouts_must_be_array" }, { status: 400 });
  }
  if (body.workouts.length > MAX_BATCH) {
    return Response.json({ error: "batch_too_large" }, { status: 400 });
  }

  const tz = getUserSettings(user.id)?.tz ?? "UTC";

  try {
    const result = ingestHealthKitWorkouts(body.workouts, user.id, tz);
    return Response.json(result);
  } catch (err) {
    console.error(
      `[ingest/healthkit] failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return Response.json({ error: "ingest_failed" }, { status: 500 });
  }
}
