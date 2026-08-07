"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import BadApiKeyBanner from "@/components/coach/BadApiKeyBanner";
import ChatInput from "@/components/coach/ChatInput";
import CoachModelPicker from "@/components/coach/CoachModelPicker";
import MessageList from "@/components/coach/MessageList";
import SuggestionChips from "@/components/coach/SuggestionChips";
import ThreadSidebar from "@/components/coach/ThreadSidebar";
import {
  type ChatMessage,
  type ThreadSummary,
  useCoachThread,
} from "@/components/coach/useCoachThread";
import type { CoachEffort } from "@/lib/coach/provider";
import type { CursorModelParamsByModel } from "@/lib/coach/cursor-model-params";

type CoachWorkspaceProps = {
  initialThreadId: number;
  initialThreads: ThreadSummary[];
  initialMessages: ChatMessage[];
  initialModelPref: string;
  initialCoachEffort: CoachEffort;
  initialCursorModelParams: CursorModelParamsByModel;
};

function formatCount(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}

export default function CoachWorkspace({
  initialThreadId,
  initialThreads,
  initialMessages,
  initialModelPref,
  initialCoachEffort,
  initialCursorModelParams,
}: CoachWorkspaceProps) {
  const [modelSaving, setModelSaving] = useState(false);
  const {
    threads,
    threadId,
    messages,
    activeThread,
    input,
    setInput,
    loading,
    preparingImages,
    pendingImages,
    attachmentError,
    addImages,
    removeImage,
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
    badApiKey,
    dismissBadApiKey,
  } = useCoachThread(initialThreadId, initialThreads, initialMessages);

  const threadTitle = activeThread?.title?.trim() || "New chat";
  const threadMeta = activeThread ? formatCount(activeThread.message_count) : "";

  return (
    <div className="coach-page">
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
          <div className="coach-topbar">
            <div className="coach-title-block">
              <div className="coach-kicker">Conversation</div>
              <h1>{threadTitle}</h1>
              <div className="coach-subtitle">{threadMeta}</div>
            </div>
            <div className="coach-topbar-actions">
              <button
                type="button"
                className="coach-mobile-threads"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={16} strokeWidth={1.8} aria-hidden />
                Threads
              </button>
            </div>
          </div>
          {badApiKey ? <BadApiKeyBanner onDismiss={dismissBadApiKey} /> : null}
          <div className="coach-messages">
            {messages.length === 0 ? (
              <div className="coach-empty">
                <div className="coach-empty-mark">Coach</div>
                <div className="coach-empty-title">Ask anything about your health data</div>
                <div className="coach-empty-copy">
                  Keep one thread per topic. The sidebar stays with you across devices.
                </div>
                <SuggestionChips
                  disabled={modelSaving}
                  onSelect={(text) => void send(text)}
                />
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
            modelChanging={modelSaving}
            modelPicker={
              <CoachModelPicker
                initialModelPref={initialModelPref}
                initialCoachEffort={initialCoachEffort}
                initialCursorModelParams={initialCursorModelParams}
                disabled={loading}
                onSavingChange={setModelSaving}
              />
            }
            preparingImages={preparingImages}
            pendingImages={pendingImages}
            attachmentError={attachmentError}
            progressLabel={progressLabel}
            inputRef={inputRef}
            onAddImages={addImages}
            onRemoveImage={removeImage}
            onSubmit={() => void send(input)}
            onKeyDown={handleKeyDown}
          />
        </section>
      </div>
    </div>
  );
}
