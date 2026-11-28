import Link from "next/link";
import ShareCard from "./ShareCard";
import { shareFilename, shareQuery, type TodayCardModel } from "@/lib/share/todayCard";
import styles from "./share.module.css";

/**
 * `/share/today` page body: the card, plus plain links for the two privacy
 * controls and the PNG download. Server-rendered, no client JS — each
 * toggle is a link to the same page with the other query value.
 */
export default function ShareTodayView({ model }: { model: TodayCardModel }) {
  const opts = { hideNumbers: model.hideNumbers, theme: model.theme };
  const toggleNumbers = shareQuery({ ...opts, hideNumbers: !opts.hideNumbers });
  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        A snapshot of your day, made to be screenshotted or downloaded. It shows no name, email or account
        details, and it is never public: only you, signed in, can open this page.
      </p>

      <div className={styles.controls} role="group" aria-label="Card options">
        <Link
          className={styles.control}
          href={`/share/today${toggleNumbers}`}
          aria-pressed={model.hideNumbers}
          prefetch={false}
        >
          {model.hideNumbers ? "Show numbers" : "Hide numbers"}
        </Link>
        <span className={styles.segment} aria-label="Theme">
          {(["dark", "light"] as const).map((theme) => (
            <Link
              key={theme}
              className={styles.control}
              href={`/share/today${shareQuery({ ...opts, theme })}`}
              aria-current={model.theme === theme ? "true" : undefined}
              prefetch={false}
            >
              {theme === "dark" ? "Dark" : "Light"}
            </Link>
          ))}
        </span>
        <a
          className={`${styles.control} ${styles.primary}`}
          href={`/api/share/today${shareQuery(opts)}`}
          download={shareFilename(model.date)}
        >
          Download PNG
        </a>
      </div>

      <div className={styles.stage}>
        <ShareCard model={model} />
      </div>
    </div>
  );
}
