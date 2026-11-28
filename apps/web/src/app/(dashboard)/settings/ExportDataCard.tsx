import { Download } from "lucide-react";
import styles from "./settings.module.css";
import own from "./export-data.module.css";
import { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS } from "@/lib/export/data-export";

// "Export my data" card for /settings, rendered by ./layout.tsx only when
// DATA_EXPORT=1. A Server Component with no client JS: a plain GET form to
// /api/export, whose `Content-Disposition: attachment` response makes the
// browser download the file and stay on the page. The quick links are plain
// `<a download>`s for the default 90-day window.

const DATASETS = [
  { value: "all", label: "Everything" },
  { value: "recovery", label: "Recovery" },
  { value: "sleep", label: "Sleep" },
  { value: "cycles", label: "Strain (daily cycles)" },
  { value: "workouts", label: "Workouts" },
  { value: "steps", label: "Steps" },
] as const;

export default function ExportDataCard() {
  return (
    <section className={styles.settingsSection} aria-labelledby="export-data-heading">
      <div className={styles.sectionIntro}>
        <span className={styles.sectionIcon}>
          <Download aria-hidden size={18} />
        </span>
        <div>
          <h2 id="export-data-heading">Export my data</h2>
          <p>Download your own recovery, sleep, strain, workout and step records.</p>
        </div>
      </div>

      <div className={styles.sectionBody}>
        <form method="get" action="/api/export" className={own.form}>
          <div className={own.fields}>
            <label className={own.field}>
              <span className={own.fieldLabel}>Dataset</span>
              <select name="kind" defaultValue="all" className={styles.select}>
                {DATASETS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={own.field}>
              <span className={own.fieldLabel}>Format</span>
              <select name="format" defaultValue="csv" className={styles.select}>
                <option value="csv">CSV (spreadsheet)</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <label className={own.field}>
              <span className={own.fieldLabel}>From</span>
              <input type="date" name="from" className={`${styles.textInput} ${own.date}`} />
            </label>
            <label className={own.field}>
              <span className={own.fieldLabel}>To</span>
              <input type="date" name="to" className={`${styles.textInput} ${own.date}`} />
            </label>
          </div>
          <p className={own.hint}>
            Leave the dates blank for the last {DEFAULT_RANGE_DAYS} days. Up to{" "}
            {MAX_RANGE_DAYS} days per file. Only your own data is included — never
            tokens, keys, Coach chats or logs.
          </p>
          <div className={own.actions}>
            <button type="submit" className={styles.primaryButton} data-track="export:download">
              <Download aria-hidden size={14} />
              Download
            </button>
            <a
              href="/api/export?kind=all&format=csv"
              download
              className={styles.secondaryButton}
              data-track="export:quick-csv"
            >
              Last {DEFAULT_RANGE_DAYS} days · CSV
            </a>
            <a
              href="/api/export?kind=all&format=json"
              download
              className={styles.secondaryButton}
              data-track="export:quick-json"
            >
              Last {DEFAULT_RANGE_DAYS} days · JSON
            </a>
          </div>
        </form>
      </div>
    </section>
  );
}
