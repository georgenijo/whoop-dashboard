import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  href: string;
  children: ReactNode;
  id: string;
};

export function Tappable({ href, children, id }: Props) {
  return (
    <Link className={styles.tappable} href={href} data-od-id={id}>
      {children}
    </Link>
  );
}
