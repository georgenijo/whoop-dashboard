"use client";

import ChatInput from "@/components/coach/ChatInput";
import MessageList from "@/components/coach/MessageList";
import SuggestionChips from "@/components/coach/SuggestionChips";
import ThreadSidebar from "@/components/coach/ThreadSidebar";
import {
  type ChatMessage,
  type ThreadSummary,
  useCoachThread,
} from "@/components/coach/useCoachThread";

type CoachWorkspaceProps = {
  initialThreadId: number;
  initialThreads: ThreadSummary[];
  initialMessages: ChatMessage[];
};

function icon(name: string) {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

function formatCount(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}

export default function CoachWorkspace({
  initialThreadId,
  initialThreads,
  initialMessages,
}: CoachWorkspaceProps) {
  const {
    threads,
    threadId,
    messages,
    activeThread,
    input,
    setInput,
    loading,
    progressLabel,
    mobileOpen,
    setMobileOpen,
    inputRef,
    bottomRef,
    send,
    handleCreateThread,
    handleSelectThread,
    handleDeleteThread,
    handleKeyDown,
  } = useCoachThread(initialThreadId, initialThreads, initialMessages);

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
            {messages.length === 0 ? (
              <div className="coach-empty">
                <div className="coach-empty-mark">Coach</div>
                <div className="coach-empty-title">Ask anything about your health data</div>
                <div className="coach-empty-copy">
                  Keep one thread per topic. The sidebar stays with you across devices.
                </div>
                <SuggestionChips onSelect={(text) => void send(text)} />
              </div>
            ) : (
              <MessageList messages={messages} />
            )}
            <div ref={bottomRef} />
          </div>

          <ChatInput
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
    </div>
  );
}
