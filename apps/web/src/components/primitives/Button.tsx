"use client";

import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  children: ReactNode;
  variant?: "primary" | "quiet" | "text";
  href?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  id: string;
};

export function Button({
  children,
  variant = "quiet",
  href,
  type = "button",
  disabled = false,
  onClick,
  id,
}: Props) {
  if (href) {
    return (
      <Link className={styles.button} data-variant={variant} data-od-id={id} href={href}>
        {children}
      </Link>
    );
  }
  return (
    <button
      className={styles.button}
      data-variant={variant}
      data-od-id={id}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
