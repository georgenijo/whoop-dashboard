import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  title: string;
  summary?: string;
  meta?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  id: string;
};

export function Disclosure({
  title,
  summary,
  meta,
  children,
  defaultOpen = false,
  id,
}: Props) {
  return (
    <details className={styles.disclosure} open={defaultOpen} data-od-id={id}>
      <summary>
        <span>
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        {meta && <span className={styles.disclosureMeta}>{meta}</span>}
        <span className={styles.disclosureChevron} aria-hidden>⌄</span>
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
