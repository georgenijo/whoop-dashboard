import { headers } from "next/headers";
import { requireAuthOrSignin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Scaffold only — T5 fills this with all-time totals, year-over-year comparison,
// by-sport breakdown, personal records, and the monthly rollup trend (see
// docs/design/healthkit-workouts/stats.html). Real data comes from new
// forUser()-scoped aggregation read fns (getAllTimeStats, getYearComparison,
// getPersonalRecords, getMonthlyRollup).
export default async function StatsPage() {
  const headerList = await headers();
  await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "var(--fg-0)" }}>
          Stats
        </h1>
        <div
          style={{
            marginTop: 4,
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        >
          Training history &amp; records
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="title">Stats are coming soon</div>
          <div className="sub">All-time totals, year-over-year trends, and personal records.</div>
        </div>
      </div>
    </>
  );
}
