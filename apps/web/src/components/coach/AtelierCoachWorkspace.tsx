"use client";

import {
  type ChatMessage,
  type ThreadSummary,
  useCoachThread,
} from "@/components/coach/useCoachThread";
import ChapterIndex from "@/components/coach/atelier/ChapterIndex";
import ChatStream from "@/components/coach/atelier/ChatStream";
import Composer from "@/components/coach/atelier/Composer";

type AtelierCoachWorkspaceProps = {
  initialThreadId: number;
  initialThreads: ThreadSummary[];
  initialMessages: ChatMessage[];
};

export default function AtelierCoachWorkspace({
  initialThreadId,
  initialThreads,
  initialMessages,
}: AtelierCoachWorkspaceProps) {
  const {
    threads,
    threadId,
    messages,
    activeThread,
    input,
    setInput,
    loading,
    progressLabel,
    inputRef,
    bottomRef,
    send,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
    handleKeyDown,
  } = useCoachThread(initialThreadId, initialThreads, initialMessages);

  const threadLabel = activeThread?.title?.trim() || "New chat";

  return (
    <div className="atelier-coach-shell">
      <ChapterIndex
        threads={threads}
        activeId={threadId}
        onSelect={handleSelectThread}
        onCreate={handleCreateThread}
        onDelete={handleDeleteThread}
      />
      <section className="atelier-coach-chat">
        <div className="atelier-chat-head">
          <span className="atelier-eyebrow-tag">Coach Intelligence</span>
          <h1 className="atelier-chat-title">{threadLabel}</h1>
          <div className="atelier-chat-subtitle">A correspondence with your body.</div>
        </div>
        <ChatStream messages={messages} bottomRef={bottomRef} threadLabel={threadLabel} />
        <Composer
          input={input}
          setInput={setInput}
          loading={loading}
          progressLabel={progressLabel}
          inputRef={inputRef}
          onSubmit={() => void send(input)}
          onKeyDown={handleKeyDown}
        />
      </section>
    </div>
  );
}
