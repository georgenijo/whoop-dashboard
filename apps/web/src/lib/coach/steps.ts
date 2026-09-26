import "server-only";
import { getStepsRange } from "@/lib/db/steps";
import { getUserSettings } from "@/lib/db/user_settings";
import { whoopGet, WhoopAuthError } from "@/lib/whoop/client";
import { upsertCyclesAndRecompute, type WhoopCycleRecord } from "@/lib/whoop/upsert";

const DAY_MS = 86_400_000;
const MAX_PAGES = 16;

/** Native steps are refreshed independently of the full-sync cooldown. A
 * successful recovery webhook says nothing about today's running step total. */
export async function querySteps(
  userId: number,
  startDate: string,
  endDate: string,
  source: "whoop" | "apple_health",
  signal?: AbortSignal,
) {
  let refresh: "updated" | "failed" | "not_requested" = "not_requested";
  let error: string | null = null;
  if (source === "whoop") {
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      // Cycle labels use local creation/wake day; starts can precede that
      // day. A three-day pad includes overnight and unusually long cycles.
      const start = new Date(Date.parse(startDate) - 3 * DAY_MS).toISOString();
      const end = new Date(Date.parse(endDate) + 2 * DAY_MS).toISOString();
      let nextToken: string | null = null;
      const records: WhoopCycleRecord[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ start, end, limit: "25" });
        if (nextToken) params.set("nextToken", nextToken);
        const result: { records?: WhoopCycleRecord[]; next_token?: string | null } = await whoopGet(
          `/v2/cycle?${params}`, { userId, signal: requestSignal },
        );
        if (!Array.isArray(result.records)) throw new Error("Missing cycle records in WHOOP response.");
        records.push(...result.records);
        nextToken = result.next_token ?? null;
        if (!nextToken) break;
      }
      if (nextToken) throw new Error("Step history exceeded the bounded fetch.");
      requestSignal.throwIfAborted();
      upsertCyclesAndRecompute(records, userId, getUserSettings(userId)?.tz ?? "UTC");
      refresh = "updated";
    } catch (err) {
      if (signal?.aborted) throw err;
      refresh = "failed";
      // Do not relay upstream response bodies or credentials into model context.
      error = err instanceof WhoopAuthError
        ? "Reconnect Whoop in Settings to refresh native steps."
        : "Could not refresh Whoop steps. Returned rows are saved data; freshness is uncertain. Try a shorter range or retry later.";
    }
  }
  const rows = getStepsRange(userId, startDate, endDate, source);
  return {
    rows,
    _meta: {
      source,
      refresh,
      error,
      last_available_date: rows.at(-1)?.date ?? null,
      time_basis: source === "whoop" ? "physiological_cycle" : "calendar_day",
      note: source === "whoop"
        ? "WHOOP-native steps per physiological cycle, labeled by local cycle creation day (start day if unavailable). These are not midnight-to-midnight totals. Preserve separate cycles sharing a label; exclude open cycles from completed-cycle baselines. Missing/null counts are unavailable, not zero. Never combine with Apple Health totals."
        : "Apple Health calendar-day totals uploaded by Coach iOS. This query does not refresh the phone's HealthKit data.",
    },
  };
}
