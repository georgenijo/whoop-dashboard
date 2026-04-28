"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";

type Message = {
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

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const html = !isUser ? (marked.parse(msg.content) as string) : null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser ? "#7b61ff" : "rgba(255,255,255,0.06)",
          border: isUser ? "none" : "1px solid rgba(255,255,255,0.08)",
          color: "var(--fg-0)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        {isUser ? (
          msg.content
        ) : msg.streaming && msg.content === "" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
            <span style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#7b61ff",
                  animation: "thinking-dot 1.2s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                  display: "inline-block",
                }} />
              ))}
            </span>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--fg-3)" }}>Thinking…</span>
          </div>
        ) : (
          <div
            className="prose-coach"
            dangerouslySetInnerHTML={{ __html: html ?? "" }}
          />
        )}
      </div>
    </div>
  );
}

function CoachInner() {
  const days = 9999;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/chat/history")
      .then((r) => r.json())
      .then((data) => {
        setMessages(
          (data as { id: number; role: string; content: string }[]).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function clearHistory() {
    await fetch("/api/chat/history", { method: "DELETE" });
    setMessages([]);
  }

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg: Message = { role: "user", content: text };
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
            messages: nextMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            days,
          }),
          signal: controller.signal,
        });

        const text = await res.text();
        if (!res.ok) throw new Error(text || `Server error ${res.status}`);

        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = { role: "assistant", content: text };
          return updated;
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setMessages((prev) => prev.slice(0, assistantIdx));
          return;
        }
        const errMsg = e instanceof Error ? e.message : String(e);
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
    },
    [messages, loading, days]
  );

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div
      className="coach-page"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        maxWidth: 720,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <style>{`
        @keyframes blink { 50% { opacity: 0 } }
        @keyframes thinking-dot { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4 } 40% { transform: scale(1); opacity: 1 } }
        .prose-coach h2 { font-size: 13px; font-weight: 600; color: var(--fg-1); margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.05em; }
        .prose-coach h3 { font-size: 13px; font-weight: 600; color: var(--fg-1); margin: 8px 0 4px; }
        .prose-coach ul { padding-left: 16px; margin: 4px 0; }
        .prose-coach li { margin: 3px 0; }
        .prose-coach p { margin: 6px 0; }
        .prose-coach strong { color: var(--fg-0); }
      `}</style>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 0 12px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loaded && messages.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, color: "var(--fg-0)", marginBottom: 6 }}>
                Coach
              </div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg-3)" }}>
                Ask anything about your health data
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 20,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--fg-1)",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "background 150ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          padding: "12px 0 20px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: "10px 12px",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={handleKey}
            placeholder="Ask about your recovery, sleep, strain…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg-0)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              resize: "none",
              lineHeight: 1.5,
              minHeight: 40,
              maxHeight: 120,
              padding: "9px 0 10px",
              overflow: "auto",
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              border: "none",
              background: input.trim() && !loading ? "#7b61ff" : "rgba(255,255,255,0.06)",
              color: input.trim() && !loading ? "#fff" : "var(--fg-3)",
              cursor: input.trim() && !loading ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 150ms",
              fontSize: 18,
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--fg-3)", textAlign: "center", marginTop: 8, display: "flex", justifyContent: "center", gap: 12 }}>
          <span>Enter to send · Shift+Enter for newline</span>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11, padding: 0, textDecoration: "underline" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CoachPage() {
  return <CoachInner />;
}
