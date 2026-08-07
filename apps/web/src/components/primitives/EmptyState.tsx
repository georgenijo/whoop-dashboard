import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  title: string;
  description: string;
  action?: ReactNode;
  id: string;
};

export function EmptyState({ title, description, action, id }: Props) {
  return (
    <div className={styles.empty} data-od-id={id}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyDescription}>{description}</div>
      {action}
    </div>
  );
}
