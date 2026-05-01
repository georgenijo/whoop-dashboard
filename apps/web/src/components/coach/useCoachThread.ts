"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ThreadSummary = {
  id: number;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_preview: string | null;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ComposerMessage = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export function useCoachThread(
  initialThreadId: number,
  initialThreads: ThreadSummary[],
  initialMessages: ChatMessage[]
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<ComposerMessage[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content }))
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeThread = threads.find((t) => t.id === threadId) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadThreads() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/threads", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ThreadSummary[];
        if (!cancelled) setThreads(data);
      } catch {
        // Ignore polling failures; the next tick will try again.
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void loadThreads();
    }

    void loadThreads();
    const timer = window.setInterval(loadThreads, 5000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function refreshThreads() {
    const res = await fetch("/api/threads", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as ThreadSummary[];
    setThreads(data);
    return data;
  }

  async function createThread(): Promise<number | null> {
    if (isPending) return null;
    const res = await fetch("/api/threads", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { id: number };
    return data.id;
  }

  async function handleCreateThread() {
    const id = await createThread();
    if (!id) return;
    setMobileOpen(false);
    startTransition(() => {
      router.push(`/coach?thread=${id}`);
    });
  }

  async function handleSelectThread(id: number) {
    setMobileOpen(false);
    startTransition(() => {
      router.push(`/coach?thread=${id}`);
    });
  }

  async function handleDeleteThread(id: number) {
    const res = await fetch(`/api/threads/${id}`, { method: "DELETE" });
    if (!res.ok) return;

    const nextThreads = await refreshThreads();
    setMobileOpen(false);
    if (id !== threadId) return;

    const nextThreadId = nextThreads[0]?.id ?? (await createThread());
    if (!nextThreadId) return;

    startTransition(() => {
      router.replace(`/coach?thread=${nextThreadId}`);
    });
  }

  async function send(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: ComposerMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantIdx = nextMessages.length;
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: userMsg.role, content: userMsg.content }],
          thread_id: threadId,
          days: 9999,
        }),
        signal: controller.signal,
      });

      const reply = await res.text();
      const nextThreadIdHeader = res.headers.get("x-thread-id");
      if (nextThreadIdHeader) {
        const nextThreadId = Number(nextThreadIdHeader);
        if (Number.isInteger(nextThreadId) && nextThreadId > 0) {
          setThreadId(nextThreadId);
        }
      }
      if (!res.ok) throw new Error(reply || `Server error ${res.status}`);

      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = { role: "assistant", content: reply };
        return updated;
      });
      void refreshThreads();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => prev.slice(0, assistantIdx));
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: "assistant",
          content: `**Error:** ${errMsg}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return {
    threads,
    threadId,
    messages,
    activeThread,
    input,
    setInput,
    loading,
    mobileOpen,
    setMobileOpen,
    inputRef,
    bottomRef,
    send,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
    handleKeyDown,
  };
}
