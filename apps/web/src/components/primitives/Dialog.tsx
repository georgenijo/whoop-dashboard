"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./primitives.module.css";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  id: string;
};

export function Dialog({ open, title, children, actions, onClose, id }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} data-od-id={id}>
      <div className={styles.dialogHead}>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close dialog">×</button>
      </div>
      <div className={styles.dialogBody}>{children}</div>
      {actions && <div className={styles.dialogActions}>{actions}</div>}
    </dialog>
  );
}
