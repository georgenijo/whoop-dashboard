import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  label?: string;
  meta?: string;
  children: ReactNode;
  action?: ReactNode;
  id: string;
};

export function Insight({ label = "Coach", meta, children, action, id }: Props) {
  return (
    <aside className={styles.insight} data-od-id={id}>
      <div className={styles.insightHead}>
        <span>{label}</span>
        {meta && <span>{meta}</span>}
      </div>
      <div className={styles.insightBody}>{children}</div>
      {action && <div className={styles.insightAction}>{action}</div>}
    </aside>
  );
}
