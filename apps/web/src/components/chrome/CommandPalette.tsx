"use client";

// Cmd/Ctrl-K quick-jump palette. Mounted by the dashboard layout ONLY when
// COMMAND_PALETTE=1 (see lib/ui/command-palette-flag.ts); with the flag off
// this module is never referenced, so no listener or chunk ships.
//
// Pure navigation: no fetches, no data reads. Results come from
// lib/ui/palette.ts over a static destination list plus the typed query.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { localIsoDate, paletteResults, type PaletteItem } from "@/lib/ui/palette";
import styles from "./CommandPalette.module.css";

export function isPaletteShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

type Props = {
  /** Injectable for tests; defaults to the viewer's local calendar date. */
  today?: () => string;
};

// Module-level so its identity is stable and the key listener isn't re-bound
// on every render.
const viewerToday = () => localIsoDate(new Date());

export default function CommandPalette({ today = viewerToday }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [todayIso, setTodayIso] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const results: PaletteItem[] = useMemo(
    () => (open ? paletteResults(query, { pathname, range }, todayIso) : []),
    [open, query, pathname, range, todayIso],
  );
  const activeIndex = results.length ? Math.min(active, results.length - 1) : -1;

  const openPalette = useCallback(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTodayIso(today());
    setQuery("");
    setActive(0);
    setOpen(true);
  }, [today]);

  const closePalette = useCallback(() => {
    setOpen(false);
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    // Defer so the portal unmounts before focus moves back.
    if (el && el.isConnected) queueMicrotask(() => el.focus());
  }, []);

  // Global shortcut. Attached only while this component is mounted, i.e. only
  // when the flag is on.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      if (open) closePalette();
      else openPalette();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette, closePalette]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`);
    el?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    // Close without restoring focus to the old control: we're navigating away.
    restoreFocusRef.current = null;
    setOpen(false);
    router.push(item.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = results.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (n) setActive((activeIndex + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (n) setActive((activeIndex - 1 + n) % n);
        break;
      case "Home":
        if (n) { e.preventDefault(); setActive(0); }
        break;
      case "End":
        if (n) { e.preventDefault(); setActive(n - 1); }
        break;
      case "Enter":
        e.preventDefault();
        choose(results[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        closePalette();
        break;
      case "Tab":
        // Focus trap: the input is the dialog's only tab stop.
        e.preventDefault();
        break;
    }
  }

  const dialog = open ? (
    <div
      className={styles.overlay}
      data-testid="command-palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Quick jump"
      >
        <div className={styles.inputRow}>
          <Search size={15} strokeWidth={1.8} aria-hidden className={styles.inputIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            aria-label="Jump to a page, action or date"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder="Jump to… (try “sleep”, “yesterday”, “2026-11-02”)"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className={styles.list}>
          {results.map((item, i) => {
            const showGroup = i === 0 || results[i - 1].group !== item.group;
            return (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className={`${styles.option} ${i === activeIndex ? styles.active : ""}`}
                data-group-start={showGroup ? item.group : undefined}
                onMouseMove={() => { if (i !== activeIndex) setActive(i); }}
                // Keep focus in the input so aria-activedescendant stays valid.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                <span className={styles.label}>{item.label}</span>
                <span className={styles.meta}>
                  {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
                  <span className={styles.group}>{item.group}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {results.length === 0 ? (
          <p className={styles.empty} role="status">
            No matches. Try a page name or a date like “last monday”.
          </p>
        ) : null}
        <div className={styles.footer} aria-hidden>
          <span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> move</span>
          <span><kbd className={styles.kbd}>↵</kbd> open</span>
          <span><kbd className={styles.kbd}>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={`icon-btn ${styles.trigger}`}
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Quick jump"
        title="Quick jump (⌘K / Ctrl-K)"
      >
        <Search size={15} strokeWidth={1.8} aria-hidden />
      </button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}
