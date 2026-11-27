"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
export type ThreadSummary = { id: number; title: string | null; updated_at: string; message_count: number; last_preview: string | null };

type SetThreads = Dispatch<SetStateAction<ThreadSummary[]>>;

export function parseThreadParam(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function threadPath(id: number): string {
  return `/coach?thread=${id}`;
}
async function fetchThreads(): Promise<ThreadSummary[]> {
  const res = await fetch("/api/threads", { cache: "no-store" });
  return res.ok ? ((await res.json()) as ThreadSummary[]) : [];
}

async function refreshThreadState(setThreads: SetThreads): Promise<ThreadSummary[]> {
  const data = await fetchThreads();
  setThreads(data);
  return data;
}

async function createThread(): Promise<number | null> {
  const res = await fetch("/api/threads", { method: "POST" });
  if (!res.ok) return null;
  return ((await res.json()) as { id: number }).id;
}

async function deleteThread(id: number): Promise<boolean> {
  return (await fetch(`/api/threads/${id}`, { method: "DELETE" })).ok;
}

// Thread switches are client-side: the URL changes through the native
// History API, which Next.js folds into its router (so `useSearchParams`, and
// Back/Forward, follow along) without fetching a new RSC payload. The messages
// themselves are loaded by `useChatSend` when `threadId` changes.
function writeThreadUrl(id: number, replace: boolean) {
  const path = threadPath(id);
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}

async function pollThreads(setThreads: SetThreads, isActive: () => boolean) {
  if (document.visibilityState === "hidden") return;
  try {
    const data = await fetchThreads();
    if (isActive()) setThreads(data);
  } catch {
    // Ignore polling failures; the next tick will try again.
  }
}

// Event-driven thread-list refresh. Replaces a 5s interval poll that hit
// /api/threads forever while /coach was open. The list only changes on events
// we already observe: sends (useChatSend calls refreshThreads on completion,
// which also picks up the auto-title now delivered on-stream), create/delete
// (local), and returning to the tab. So refresh on mount + focus/visibility,
// and let those other paths cover the rest — no standing interval.
function watchThreads(setThreads: SetThreads) {
  let cancelled = false;
  const isActive = () => !cancelled;
  const refreshWhenVisible = () => void pollThreads(setThreads, isActive);

  void pollThreads(setThreads, isActive);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  window.addEventListener("focus", refreshWhenVisible);
  return () => {
    cancelled = true;
    document.removeEventListener("visibilitychange", refreshWhenVisible);
    window.removeEventListener("focus", refreshWhenVisible);
  };
}

export function useThreadList({
  initialThreadId,
  initialThreads,
  onNavigate,
}: { initialThreadId: number; initialThreads: ThreadSummary[]; onNavigate: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlThreadId = parseThreadParam(searchParams?.get("thread"));
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState(initialThreadId);
  const creatingRef = useRef(false);
  const activeThread = threads.find((t) => t.id === threadId) ?? null;

  // Follow the URL when it changes (Back/Forward, a link to `/coach?thread=N`
  // while Coach is open, or our own pushState landing). A bare `/coach` is the newest
  // thread, which is what the server rendered as `initialThreadId`.
  // Adjusting state during render (not in an effect) keeps it to one pass.
  // The thread a bare `/coach` showed when Coach mounted. Captured once:
  // later refreshes render the URL's own thread as `initialThreadId`.
  const [bareThreadId] = useState(initialThreadId);
  const [seenUrlThreadId, setSeenUrlThreadId] = useState(urlThreadId);
  if (seenUrlThreadId !== urlThreadId) {
    setSeenUrlThreadId(urlThreadId);
    setThreadId(urlThreadId ?? bareThreadId);
  }

  // `/coach?thread=<missing or foreign id>` renders the newest thread instead
  // (no redirect); make the address bar say which one.
  // Mount only: a later `router.refresh()` re-renders the URL's own thread.
  const mountRef = useRef({ requested: urlThreadId, rendered: initialThreadId });
  useEffect(() => {
    const { requested, rendered } = mountRef.current;
    if (requested !== null && requested !== rendered) writeThreadUrl(rendered, true);
  }, []);

  useEffect(() => watchThreads(setThreads), []);

  const selectThread = useCallback((id: number, replace = false) => {
    // Only `threadId` moves here. `seenUrlThreadId` tracks the URL itself:
    // Next applies the History API update in a later render, and comparing
    // against the URL's previous value (not our selection) is what keeps that
    // in-between render from snapping back to the old thread.
    setThreadId(id);
    writeThreadUrl(id, replace);
  }, []);

  const refreshThreads = useCallback(() => refreshThreadState(setThreads), []);

  const handleCreateThread = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const id = await createThread();
      if (!id) return;
      onNavigate();
      selectThread(id);
      void refreshThreadState(setThreads);
      // A new thread changes what cached `/coach` payloads render (which
      // thread a bare `/coach` shows, and each page's sidebar seed), and
      // `staleTimes.dynamic` would keep serving them. Clear the client router
      // cache; the live workspace ignores the refreshed props.
      router.refresh();
    } finally {
      creatingRef.current = false;
    }
  }, [onNavigate, router, selectThread]);

  const handleSelectThread = useCallback(
    (id: number) => {
      onNavigate();
      if (id !== threadId) selectThread(id);
    },
    [onNavigate, selectThread, threadId]
  );

  const handleDeleteThread = useCallback(async (id: number) => {
    const deleted = await deleteThread(id);
    if (!deleted) return;
    // Drop cached `/coach?thread=N` payloads so going back can't resurrect the
    // deleted thread from the 30s client router cache.
    router.refresh();

    const nextThreads = await refreshThreads();
    onNavigate();
    if (id !== threadId) return;

    const nextThreadId = nextThreads[0]?.id ?? (await createThread());
    if (!nextThreadId) return;
    selectThread(nextThreadId, true);
  }, [onNavigate, refreshThreads, router, selectThread, threadId]);

  return {
    threads,
    threadId,
    setThreadId,
    activeThread,
    refreshThreads,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
  };
}
