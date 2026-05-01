"use client";
import { useCallback, useEffect, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
export type ThreadSummary = { id: number; title: string | null; updated_at: string; message_count: number; last_preview: string | null };

type Router = ReturnType<typeof useRouter>;
type SetThreads = Dispatch<SetStateAction<ThreadSummary[]>>;
type StartTransition = (callback: () => void) => void;
async function fetchThreads(): Promise<ThreadSummary[]> {
  const res = await fetch("/api/threads", { cache: "no-store" });
  return res.ok ? ((await res.json()) as ThreadSummary[]) : [];
}

async function refreshThreadState(setThreads: SetThreads): Promise<ThreadSummary[]> {
  const data = await fetchThreads();
  setThreads(data);
  return data;
}

async function createThread(isPending: boolean): Promise<number | null> {
  if (isPending) return null;
  const res = await fetch("/api/threads", { method: "POST" });
  if (!res.ok) return null;
  return ((await res.json()) as { id: number }).id;
}

async function deleteThread(id: number): Promise<boolean> {
  return (await fetch(`/api/threads/${id}`, { method: "DELETE" })).ok;
}

function navigateThread(router: Router, startTransition: StartTransition, id: number, replace = false) {
  startTransition(() => {
    const path = `/coach?thread=${id}`;
    if (replace) router.replace(path);
    else router.push(path);
  });
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

function watchThreads(setThreads: SetThreads) {
  let cancelled = false;
  const isActive = () => !cancelled;
  const refreshWhenVisible = () => void pollThreads(setThreads, isActive);

  void pollThreads(setThreads, isActive);
  const timer = window.setInterval(() => void pollThreads(setThreads, isActive), 5000);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  window.addEventListener("focus", refreshWhenVisible);
  return () => {
    cancelled = true;
    window.clearInterval(timer);
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
  const [isPending, startTransition] = useTransition();
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState(initialThreadId);
  const activeThread = threads.find((t) => t.id === threadId) ?? null;

  useEffect(() => watchThreads(setThreads), []);

  const refreshThreads = useCallback(() => refreshThreadState(setThreads), []);

  const handleCreateThread = useCallback(async () => {
    const id = await createThread(isPending);
    if (!id) return;
    onNavigate();
    navigateThread(router, startTransition, id);
  }, [isPending, onNavigate, router, startTransition]);

  const handleSelectThread = useCallback(
    (id: number) => {
      onNavigate();
      navigateThread(router, startTransition, id);
    },
    [onNavigate, router, startTransition]
  );

  const handleDeleteThread = useCallback(async (id: number) => {
    const deleted = await deleteThread(id);
    if (!deleted) return;

    const nextThreads = await refreshThreads();
    onNavigate();
    if (id !== threadId) return;

    const nextThreadId = nextThreads[0]?.id ?? (await createThread(isPending));
    if (!nextThreadId) return;
    navigateThread(router, startTransition, nextThreadId, true);
  }, [isPending, onNavigate, refreshThreads, router, startTransition, threadId]);

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
