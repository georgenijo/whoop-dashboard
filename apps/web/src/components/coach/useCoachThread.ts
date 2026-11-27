"use client";

import {
  useCallback,
  useState,
  type KeyboardEvent,
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
import { useAutoScroll } from "@/components/coach/useAutoScroll";

export type { ChatMessage, ComposerMessage, ThreadSummary };

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
  // Ephemeral banner state for the BYOK 401 path. Reset to false on every
  // new send (inside sendChatMessage) and on dismiss; not persisted.
  const [badApiKey, setBadApiKey] = useState(false);
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

  const {
    messages,
    input,
    setInput,
    loading,
    finishing,
    preparingImages,
    pendingImages,
    attachmentError,
    addImages,
    removeImage,
    inputRef,
    send: sendMessage,
    stop,
    retry,
    progressLabel,
  } = useChatSend({
    initialMessages,
    threadId,
    setThreadId,
    refreshThreads,
    setBadApiKey,
  });

  const {
    containerRef: messagesRef,
    onScroll: onMessagesScroll,
    showJump: showJumpToLatest,
    jumpToLatest,
  } = useAutoScroll(messages, threadId);

  // Sending is an explicit "show me the latest", so it re-pins the transcript
  // even if the reader had scrolled up.
  const send = useCallback(
    (text: string) => {
      jumpToLatest();
      return sendMessage(text);
    },
    [jumpToLatest, sendMessage],
  );
  const retryLast = useCallback(() => {
    jumpToLatest();
    return retry();
  }, [jumpToLatest, retry]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => submitOnEnter(e, input, send),
    [input, send]
  );

  const dismissBadApiKey = useCallback(() => setBadApiKey(false), []);

  return {
    threads,
    threadId,
    messages,
    activeThread,
    input,
    setInput,
    loading,
    finishing,
    preparingImages,
    pendingImages,
    attachmentError,
    addImages,
    removeImage,
    progressLabel,
    mobileOpen,
    setMobileOpen,
    inputRef,
    messagesRef,
    onMessagesScroll,
    showJumpToLatest,
    jumpToLatest,
    send,
    stop,
    retry: retryLast,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
    handleKeyDown,
    badApiKey,
    dismissBadApiKey,
  };
}
