"use client";
import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

export type ChatMessage = { id: number; role: "user" | "assistant"; content: string; created_at: string };
export type ComposerMessage = { role: "user" | "assistant"; content: string; streaming?: boolean };

type UseChatSendParams = { initialMessages: ChatMessage[]; threadId: number; setThreadId: Dispatch<SetStateAction<number>>; refreshThreads: () => Promise<unknown> };

type SendParams = Omit<UseChatSendParams, "initialMessages"> & {
  text: string;
  messages: ComposerMessage[];
  loading: boolean;
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>;
  setInput: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  abortRef: RefObject<AbortController | null>;
};

function setAssistantMessage(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  content: string
) {
  setMessages((prev) => {
    const updated = [...prev];
    updated[index] = { role: "assistant", content };
    return updated;
  });
}

function applyThreadHeader(res: Response, setThreadId: Dispatch<SetStateAction<number>>) {
  const value = res.headers.get("x-thread-id");
  if (!value) return;
  const nextThreadId = Number(value);
  if (Number.isInteger(nextThreadId) && nextThreadId > 0) setThreadId(nextThreadId);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function postMessage(userMsg: ComposerMessage, threadId: number, signal: AbortSignal): Promise<Response> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: userMsg.role, content: userMsg.content }], thread_id: threadId, days: 9999 }),
    signal,
  });
}

async function sendChatMessage(params: SendParams) {
  if (!params.text.trim() || params.loading) return;

  const userMsg: ComposerMessage = { role: "user", content: params.text };
  const nextMessages = [...params.messages, userMsg];
  params.setMessages(nextMessages);
  params.setInput("");
  if (params.inputRef.current) params.inputRef.current.style.height = "auto";
  params.setLoading(true);

  params.abortRef.current?.abort();
  const controller = new AbortController();
  params.abortRef.current = controller;

  const assistantIdx = nextMessages.length;
  params.setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

  try {
    const res = await postMessage(userMsg, params.threadId, controller.signal);
    const reply = await res.text();
    applyThreadHeader(res, params.setThreadId);
    if (!res.ok) throw new Error(reply || `Server error ${res.status}`);

    setAssistantMessage(params.setMessages, assistantIdx, reply);
    void params.refreshThreads();
  } catch (err) {
    if (isAbortError(err)) {
      params.setMessages((prev) => prev.slice(0, assistantIdx));
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    setAssistantMessage(params.setMessages, assistantIdx, `**Error:** ${errMsg}`);
  } finally {
    params.setLoading(false);
    params.inputRef.current?.focus();
  }
}

export function useChatSend({
  initialMessages,
  threadId,
  setThreadId,
  refreshThreads,
}: UseChatSendParams) {
  const [messages, setMessages] = useState<ComposerMessage[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content }))
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback((text: string) => sendChatMessage({
    text,
    messages,
    loading,
    threadId,
    setThreadId,
    setMessages,
    setInput,
    setLoading,
    inputRef,
    abortRef,
    refreshThreads,
  }), [loading, messages, refreshThreads, setThreadId, threadId]);

  return { messages, input, setInput, loading, inputRef, send };
}
