"use client";

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
          <div className="bn-drawer coach-drawer" role="dialog" aria-label="Threads">
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
