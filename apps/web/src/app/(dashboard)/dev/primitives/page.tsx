import { headers } from "next/headers";
import {
  Button,
  Chart,
  DataTable,
  Disclosure,
  EmptyState,
  Insight,
  Metric,
  Notice,
  Tag,
  Tappable,
  Zone,
} from "@/components/primitives";
import { requireAuthOrSignin } from "@/lib/auth";
import { PrimitiveGalleryClient } from "./PrimitiveGalleryClient";
import styles from "./gallery.module.css";

const chartData = [62, 68, 65, 72, 70, 75, 74, 79].map((value, index) => ({
  label: `Day ${index + 1}`,
  value,
}));

const workoutRows = [
  { workout: "Running", zone: <Tag>Z3</Tag>, strain: "14.2", duration: "48m" },
  { workout: "Strength", zone: <Tag>Z2</Tag>, strain: "9.6", duration: "62m" },
  { workout: "Cycling", zone: <Tag>Z4</Tag>, strain: "16.8", duration: "95m" },
];

export default async function PrimitivesPage() {
  const headerList = await headers();
  await requireAuthOrSignin(new Request("http://localhost", { headers: headerList }));

  return (
    <div className={styles.page} data-od-id="primitive-gallery">
      <header className={styles.intro}>
        <span className={styles.kicker}>Quiet Instrument · Layer 1</span>
        <h1>The twelve primitives</h1>
        <p>Real components against the live token system. Sample values are labelled and never read from the production database.</p>
      </header>

      <div className={styles.grid}>
        <Zone id="gallery-hero" label="Metric · hero and quiet tiers">
          <Metric id="gallery-recovery" metric="recovery" label="Recovery" value={68} unit="%" tier="hero" delta={{ label: "+6 vs 7-day mean", direction: "up" }} />
          <div className={styles.metrics}>
            <Metric id="gallery-hrv" metric="hrv" label="HRV" value={74} unit="ms" delta={{ label: "+3", direction: "up" }} />
            <Metric id="gallery-rhr" metric="rhr" label="RHR" value={52} unit="bpm" delta={{ label: "+2", direction: "down" }} />
            <Metric id="gallery-sleep" metric="sleep" label="Sleep" value={7.4} unit="h" delta={{ label: "±0.1" }} />
          </div>
        </Zone>

        <Zone id="gallery-chart" label="Chart · direct label, no grid">
          <Chart id="gallery-hrv-chart" metric="hrv" data={chartData} ariaLabel="Sample HRV trend rising from 62 to 79 milliseconds" startLabel="31 Jul" endLabel="7 Aug" valueLabel="79 ms" />
        </Zone>

        <Zone id="gallery-table" label="Data table · hairlines only">
          <DataTable
            id="gallery-workouts-table"
            caption="Sample workouts"
            columns={[
              { key: "workout", label: "Workout" },
              { key: "zone", label: "Zone" },
              { key: "strain", label: "Strain", numeric: true },
              { key: "duration", label: "Duration", numeric: true },
            ]}
            rows={workoutRows}
          />
        </Zone>

        <Zone id="gallery-states" label="States and actions">
          <div className={styles.stack}>
            <Notice id="gallery-notice" title="Whoop sync is 19 hours stale" description="Last successful pull ran yesterday at 04:12." />
            <div className={styles.actions}>
              <Button id="gallery-primary" variant="primary">Reconnect</Button>
              <Button id="gallery-quiet">View sync log</Button>
              <Button id="gallery-text" variant="text">Dismiss</Button>
              <PrimitiveGalleryClient />
            </div>
            <div className={styles.actions}>
              <Tag tone="ok">Adequate</Tag>
              <Tag tone="warn">Stale</Tag>
              <Tag tone="bad">Failed</Tag>
            </div>
          </div>
        </Zone>

        <Zone id="gallery-insight" label="Insight · model judgment">
          <Insight id="gallery-coach-insight" meta="sample · 30 days" action={<Button id="gallery-followup" variant="text">Ask a follow-up</Button>}>
            HRV is moving up while resting heart rate is slightly elevated. You have room for a moderate session, but protecting tomorrow is the better trade.
          </Insight>
        </Zone>

        <Zone id="gallery-disclosure" label="Disclosure, tappable, empty">
          <Disclosure id="gallery-sleep-detail" title="Last night’s sleep" summary="7h 24m · 88% performance" meta="detail">
            <p>Deep 1h 22m · REM 1h 48m · Light 3h 51m · Awake 23m</p>
          </Disclosure>
          <Tappable id="gallery-tappable" href="/recovery">Open recovery detail</Tappable>
          <EmptyState id="gallery-empty" title="No naps recorded" description="Naps appear here once Whoop logs a sleep under 90 minutes." action={<Button id="gallery-empty-action" variant="text">How naps are detected</Button>} />
        </Zone>
      </div>
    </div>
  );
}
