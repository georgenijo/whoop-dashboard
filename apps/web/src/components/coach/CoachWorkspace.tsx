"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import ThreadSidebar from "@/components/coach/ThreadSidebar";

type ThreadSummary = {
  id: number;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_preview: string | null;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type CoachWorkspaceProps = {
  initialThreadId: number;
  initialThreads: ThreadSummary[];
  initialMessages: ChatMessage[];
};

type ComposerMessage = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

const SUGGESTIONS = [
  "How is my recovery trending this week?",
  "What does my sleep quality look like?",
  "Am I overtraining based on my strain?",
  "What should I focus on to improve HRV?",
];

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

function formatCount(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}

function MessageBubble({ msg }: { msg: ComposerMessage }) {
  const isUser = msg.role === "user";
  const html = !isUser ? (marked.parse(msg.content) as string) : null;

  return (
    <div className={`coach-message-row ${isUser ? "user" : "assistant"}`}>
      <div className={`coach-message ${isUser ? "user" : "assistant"}`}>
        {isUser ? (
          msg.content
        ) : msg.streaming && msg.content === "" ? (
          <div className="coach-thinking">
            <span className="coach-thinking-dots">
              {[0, 1, 2].map((i) => (
                <span key={i} className="coach-thinking-dot" style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </span>
            <span className="coach-thinking-label">Thinking...</span>
          </div>
        ) : (
          <div className="prose-coach" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
        )}
      </div>
    </div>
  );
}

export default function CoachWorkspace({
  initialThreadId,
  initialThreads,
  initialMessages,
}: CoachWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<ComposerMessage[]>(
    initialMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeThread = threads.find((thread) => thread.id === threadId) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadThreads() {
      if (document.visibilityState === "hidden") return;

      try {
        const res = await fetch("/api/threads", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ThreadSummary[];
        if (!cancelled) {
          setThreads(data);
        }
      } catch {
        // Ignore polling failures; the next tick will try again.
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void loadThreads();
      }
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
    setMessages(
      initialMessages.map((message) => ({
        role: message.role,
        content: message.content,
      }))
    );
    setThreadId(initialThreadId);
    setLoaded(true);
  }, [initialMessages, initialThreadId]);

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
    if (id !== threadId) {
      return;
    }

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
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
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

  const threadTitle = activeThread?.title?.trim() || "New chat";
  const threadMeta = activeThread ? formatCount(activeThread.message_count) : "";

  return (
    <div className="coach-page">
      <div className="coach-topbar">
        <div className="coach-title-block">
          <div className="coach-kicker">Coach</div>
          <h1>{threadTitle}</h1>
          <div className="coach-subtitle">{threadMeta}</div>
        </div>
        <button
          type="button"
          className="coach-mobile-threads"
          onClick={() => setMobileOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon("menu")} alt="" />
          Threads
        </button>
      </div>

      <div className="coach-shell">
        <ThreadSidebar
          threads={threads}
          activeThreadId={threadId}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
          onCreateThread={handleCreateThread}
          onSelectThread={handleSelectThread}
          onDeleteThread={handleDeleteThread}
        />

        <section className="coach-chat">
          <div className="coach-messages">
            {loaded && messages.length === 0 && (
              <div className="coach-empty">
                <div className="coach-empty-mark">Coach</div>
                <div className="coach-empty-title">Ask anything about your health data</div>
                <div className="coach-empty-copy">
                  Keep one thread per topic. The sidebar stays with you across devices.
                </div>
                <div className="coach-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="coach-suggestion"
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <MessageBubble key={index} msg={message} />
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="coach-composer">
            <div className="coach-input-shell">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your recovery, sleep, strain..."
                rows={1}
                disabled={loading}
                className="coach-input"
              />
              <button
                type="button"
                className="coach-send"
                onClick={() => void send(input)}
                disabled={!input.trim() || loading}
              >
                ↑
              </button>
            </div>
            <div className="coach-footer">
              <span>Enter to send · Shift+Enter for newline</span>
              <span>{loading ? "Thinking..." : " "}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
