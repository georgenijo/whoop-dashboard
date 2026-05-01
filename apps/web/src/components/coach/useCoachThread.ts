"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  type ChatMessage,
  type ComposerMessage,
  useChatSend,
} from "@/components/coach/useChatSend";
import {
  type ThreadSummary,
  useThreadList,
} from "@/components/coach/useThreadList";

export type { ChatMessage, ComposerMessage, ThreadSummary };

function scrollToBottom(bottomRef: RefObject<HTMLDivElement | null>) {
  bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function submitOnEnter(
  e: KeyboardEvent<HTMLTextAreaElement>,
  input: string,
  send: (text: string) => void
) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input);
  }
}

export function useCoachThread(
  initialThreadId: number,
  initialThreads: ThreadSummary[],
  initialMessages: ChatMessage[]
) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const {
    threads,
    threadId,
    setThreadId,
    activeThread,
    refreshThreads,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
  } = useThreadList({ initialThreadId, initialThreads, onNavigate: closeMobile });

  const { messages, input, setInput, loading, inputRef, send } = useChatSend({
    initialMessages,
    threadId,
    setThreadId,
    refreshThreads,
  });

  useEffect(() => scrollToBottom(bottomRef), [messages]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => submitOnEnter(e, input, send),
    [input, send]
  );

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
