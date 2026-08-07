import type { ReactNode } from "react";
import type { Tone } from "./types";
import styles from "./primitives.module.css";

type Props = {
  title: string;
  description?: string;
  tone?: Exclude<Tone, "neutral">;
  action?: ReactNode;
  id: string;
};

export function Notice({ title, description, tone = "warn", action, id }: Props) {
  return (
    <div className={styles.notice} data-tone={tone} data-od-id={id} role="status">
      <div>
        <div className={styles.noticeTitle}>{title}</div>
        {description && <div className={styles.noticeDescription}>{description}</div>}
      </div>
      {action && <div className={styles.noticeAction}>{action}</div>}
    </div>
  );
}
