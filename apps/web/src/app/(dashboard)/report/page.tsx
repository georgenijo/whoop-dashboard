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
import {
  computeHealthReport,
  parseReportDays,
  reportWindow,
} from "@/lib/analytics/healthReport";
import { isHealthReportEnabled } from "@/lib/health-report-flag";
import HealthReportView from "@/components/report/HealthReportView";
import "@/styles/report.css";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  // Gate first: with the flag off this route does no auth or DB work at all.
  if (!isHealthReportEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  const { days: rawDays } = await searchParams;
  const days = parseReportDays(rawDays);
  const today = localToday();
  const { start, end } = reportWindow(today, days);

  const report = computeHealthReport({
    today,
    days,
    recovery: getRecoveryRange(user.id, start, end),
    sleep: getSleepRange(user.id, start, end),
    cycles: getStrainRange(user.id, start, end),
    workouts: getWorkoutRowsRange(user.id, start, end),
  });

  return <HealthReportView report={report} />;
}
