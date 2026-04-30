"use client";

import { useEffect, useRef } from "react";

type ThreadSummary = {
  id: number;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_preview: string | null;
};

type ThreadSidebarProps = {
  threads: ThreadSummary[];
  activeThreadId: number;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onCreateThread: () => Promise<void>;
  onSelectThread: (threadId: number) => void;
  onDeleteThread: (threadId: number) => Promise<void>;
};

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

function formatRelativeTime(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
      ].join(",")
    )
  ).filter((element) => !element.getAttribute("aria-hidden"));
}

function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onDeleteThread,
}: Pick<
  ThreadSidebarProps,
  "threads" | "activeThreadId" | "onSelectThread" | "onDeleteThread"
>) {
  return (
    <div className="coach-thread-list">
      {threads.map((thread) => {
        const active = thread.id === activeThreadId;
        return (
          <div key={thread.id} className="coach-thread-row">
            <button
              type="button"
              className={`sb-link coach-thread-item ${active ? "active" : ""}`}
              onClick={() => onSelectThread(thread.id)}
            >
              <span className="coach-thread-title">
                {thread.title?.trim() || "New chat"}
              </span>
              <span className="coach-thread-meta">
                {formatRelativeTime(thread.updated_at)}
                {thread.message_count ? ` · ${thread.message_count} messages` : ""}
              </span>
              <span className="coach-thread-preview">
                {thread.last_preview?.trim() || "No messages yet"}
              </span>
            </button>
            <button
              type="button"
              className="coach-thread-delete"
              aria-label={`Delete ${thread.title?.trim() || "New chat"}`}
              onClick={() => void onDeleteThread(thread.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon("trash-2")} alt="" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function ThreadSidebar({
  threads,
  activeThreadId,
  mobileOpen,
  onMobileOpenChange,
  onCreateThread,
  onSelectThread,
  onDeleteThread,
}: ThreadSidebarProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const focusableElements = getFocusableElements(drawer);
    (focusableElements[0] ?? drawer).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onMobileOpenChange(false);
        return;
      }

      if (event.key !== "Tab" || !drawer) return;

      const elements = getFocusableElements(drawer);
      if (elements.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (!drawer.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [mobileOpen, onMobileOpenChange]);

  return (
    <>
      <aside className="coach-sidebar">
        <div className="sb-brand coach-sidebar-brand">
          <div className="mark">C</div>
          <span className="wm">
            threads<span className="plus">+</span>
          </span>
        </div>

        <button
          type="button"
          className="sb-link coach-new-thread"
          onClick={() => void onCreateThread()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon("plus")} alt="" />
          New chat
        </button>

        <div className="sb-group-label">Threads</div>
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          onDeleteThread={onDeleteThread}
        />
      </aside>

      {mobileOpen && (
        <>
          <div
            className="bn-drawer-backdrop"
            onClick={() => onMobileOpenChange(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            className="bn-drawer coach-drawer"
            role="dialog"
            aria-label="Threads"
            tabIndex={-1}
          >
            <div className="bn-drawer-handle" />
            <button
              type="button"
              className="sb-link coach-new-thread"
              onClick={() => void onCreateThread()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon("plus")} alt="" />
              New chat
            </button>
            <ThreadList
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
            />
          </div>
        </>
      )}
    </>
  );
}
