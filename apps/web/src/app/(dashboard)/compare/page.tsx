import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getWorkoutRowsRange,
} from "@/lib/db";
import { localToday } from "@/lib/date";
import { isPeriodCompareEnabled } from "@/lib/period-compare-flag";
import {
  PRESETS,
  comparePeriods,
  resolveComparison,
  type CompareParams,
  type Period,
  type PeriodData,
} from "@/lib/analytics/comparePeriods";
import CompareView from "@/components/compare/CompareView";

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function loadPeriod(userId: number, p: Period): PeriodData {
  return {
    recovery: getRecoveryRange(userId, p.from, p.to),
    sleep: getSleepRange(userId, p.from, p.to),
    cycles: getStrainRange(userId, p.from, p.to),
    workouts: getWorkoutRowsRange(userId, p.from, p.to),
  };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Flag check first: with PERIOD_COMPARE off nothing below runs — no auth
  // lookup beyond the layout's, and no domain reads.
  if (!isPeriodCompareEnabled()) notFound();

  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: await headers() }),
  );
  const sp = await searchParams;
  const params: CompareParams = {
    preset: first(sp.preset),
    a_from: first(sp.a_from),
    a_to: first(sp.a_to),
    b_from: first(sp.b_from),
    b_to: first(sp.b_to),
  };
  const today = localToday();
  const resolved = resolveComparison(params, today);
  const rows = comparePeriods(
    resolved.a,
    resolved.b,
    loadPeriod(user.id, resolved.a),
    loadPeriod(user.id, resolved.b),
  );

  return (
    <CompareView
      resolved={resolved}
      rows={rows}
      today={today}
      presets={PRESETS}
    />
  );
}
