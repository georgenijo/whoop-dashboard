import Link from "next/link";
import { headers } from "next/headers";
import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import { getOverview, getStepsTrend, getLatestSteps, getPreviousSteps, getUserSettings, resolveStepsSource } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { resolveRangeWindow } from "@/lib/range";
import { parseDate } from "@/lib/whoop/upsert";

export const dynamic = "force-dynamic";

export default async function StepsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; source?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range, source: requestedSource } = await searchParams;
  const source = resolveStepsSource(user.id, requestedSource === "apple_health" || requestedSource === "whoop" ? requestedSource : "auto");
  const native = source === "whoop";
  const tz = getUserSettings(user.id)?.tz ?? "UTC";
  const window = resolveRangeWindow(range, parseDate(new Date().toISOString(), tz));
  const formatTime = (value: string) => new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value) ? value.replace(" ", "T") + "Z" : value).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const overview = getOverview(user.id, window.days);
  const trend = getStepsTrend(user.id, window.start, window.end, source);

  const completed = trend.filter((row) => !row.is_partial);
  const completedAverage = completed.length ? Math.round(completed.reduce((sum, row) => sum + row.steps, 0) / completed.length) : null;
  const latest = getLatestSteps(user.id, source);
  const previous = getPreviousSteps(user.id, source);

  return (
    <>
      <KPIStrip
        latestRecovery={overview.latestRecovery}
        previousRecovery={overview.previousRecovery}
        latestCycle={overview.latestCycle}
        previousCycle={overview.previousCycle}
        latestSleep={overview.latestSleep}
        previousSleep={overview.previousSleep}
        latestSteps={latest}
        previousSteps={previous}
        recoveryTrend={overview.recoveryTrend}
        strainTrend={overview.strainTrend}
        sleepTrend={overview.sleepTrend}
      />

      <div className="card" style={{ marginTop: "var(--s6)", paddingTop: 0 }}>
        <nav aria-label="Step source" style={{ display: "flex", gap: "var(--s4)", marginBottom: "var(--s3)" }}>
          <Link href={`/steps?range=${encodeURIComponent(range ?? "30d")}&source=whoop`} aria-current={native ? "page" : undefined}>Whoop</Link>
          <Link href={`/steps?range=${encodeURIComponent(range ?? "30d")}&source=apple_health`} aria-current={!native ? "page" : undefined}>Apple Health</Link>
        </nav>
        <div className="card-sub">
          {native ? "Whoop · steps per physiological cycle, labeled by local cycle creation day. These may differ from calendar-day totals." : "Apple Health · calendar-day totals synced by Coach iOS."}
        </div>
        <div className="card-sub" style={{ marginTop: "var(--s2)" }}>
          {latest ? `Latest available: ${latest.date} · ${latest.is_partial ? "in progress · " : ""}checked ${formatTime(latest.fetched_at ?? latest.updated_at)}` : "No steps available from this source yet."}
          {native ? " Use Sync to refresh Whoop data." : " Open Coach iOS to upload Apple Health data."}
        </div>
      </div>

      <TrendChart
        title={native ? "Whoop Cycle Steps" : "Daily Steps"}
        subtitle={window.label}
        averageLabel={native ? (completedAverage == null ? "No completed cycles" : `${completedAverage.toLocaleString("en-US")} steps · ${completed.length} completed cycles`) : undefined}
        color="#5ac8fa"
        gradientId="steps"
        data={trend.map((row) => ({ date: row.date, value: row.steps }))}
        unit=" steps"
        showRollingToggle={!native}
        emptySubtext={native ? "Sync Whoop to load native steps" : "Sync Apple Health from Coach iOS to populate this chart"}
      />
      {native && trend.length > 0 && (
        <details className="card" style={{ marginTop: "var(--s4)" }}>
          <summary>Cycle details · {trend.length} available cycles</summary>
          <div style={{ overflowX: "auto", marginTop: "var(--s3)" }}>
            <table style={{ width: "100%", textAlign: "left" }}>
              <thead><tr><th>Cycle day</th><th>Steps</th><th>Period ({tz})</th></tr></thead>
              <tbody>{trend.map((row) => (
                <tr key={row.cycle_id}>
                  <td>{row.date}</td>
                  <td>{row.steps.toLocaleString("en-US")}{row.is_partial ? " so far" : ""}</td>
                  <td>{row.cycle_start ? formatTime(row.cycle_start) : "—"} – {row.cycle_end ? formatTime(row.cycle_end) : "ongoing"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
