import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  label?: string;
  children: ReactNode;
  id: string;
};

export function Zone({ label, children, id }: Props) {
  return (
    <section className={styles.zone} data-od-id={id}>
      {label && <span className={styles.kicker}>{label}</span>}
      {children}
    </section>
  );
}
