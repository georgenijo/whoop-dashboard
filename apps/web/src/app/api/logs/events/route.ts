import { requireAuth } from "@/lib/auth";
import {
  getUnifiedEvents,
  type EventLevel,
  type EventSource,
} from "@/lib/db/events";

export const dynamic = "force-dynamic";

const VALID_SOURCES: EventSource[] = [
  "server",
  "web",
  "ios",
  "sync",
  "coach",
  "webhook",
  "route",
];
const VALID_LEVELS: EventLevel[] = ["info", "warn", "error", "fatal"];

function parseListParam<T extends string>(raw: string | null, allowed: T[]): T[] | undefined {
  if (!raw) return undefined;
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const filtered = tokens.filter((t): t is T => (allowed as readonly string[]).includes(t));
  return filtered.length ? filtered : undefined;
}

function parseRange(raw: string | null): Date | undefined {
  if (!raw || raw === "all") return undefined;
  const now = Date.now();
  const map: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  const ms = map[raw];
  return ms ? new Date(now - ms) : undefined;
}

export async function GET(req: Request) {
  try {
    await requireAuth(req);
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const sources = parseListParam(url.searchParams.get("sources"), VALID_SOURCES);
  const levels = parseListParam(url.searchParams.get("levels"), VALID_LEVELS);
  const q = url.searchParams.get("q") ?? undefined;
  const since = parseRange(url.searchParams.get("range") ?? "24h");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const events = getUnifiedEvents({ sources, levels, q, since, limit });

  return Response.json({ events });
}
