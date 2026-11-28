import { connection } from "next/server";
import ExportDataCard from "./ExportDataCard";
import styles from "./settings.module.css";
import exportStyles from "./export-data.module.css";
import { isDataExportEnabled } from "@/lib/export/flag";

// Settings segment layout. Its only job is the flag-gated "Export my data"
// card: the page itself is a Client Component, so the server-side
// DATA_EXPORT check lives here. Flag off → renders `children` untouched (no
// extra markup, no DB read). `connection()` keeps the env check per-request
// rather than baked in at build time.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isDataExportEnabled()) return children;
  return (
    <>
      {children}
      <div className={`${styles.settingsPage} ${exportStyles.wrap}`}>
        <div className={styles.settingsSurface}>
          <ExportDataCard />
        </div>
      </div>
    </>
  );
}
