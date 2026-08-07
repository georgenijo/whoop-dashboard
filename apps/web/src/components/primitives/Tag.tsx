import type { ReactNode } from "react";
import type { Tone } from "./types";
import styles from "./primitives.module.css";

type Props = {
  tone?: Tone;
  children: ReactNode;
  id?: string;
};

export function Tag({ tone = "neutral", children, id }: Props) {
  return (
    <span className={styles.tag} data-tone={tone} data-od-id={id}>
      <i aria-hidden />
      {children}
    </span>
  );
}
