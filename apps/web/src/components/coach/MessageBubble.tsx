"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState } from "react";
import CoachWorkDisclosure from "./CoachWorkDisclosure";
import type { ComposerMessage } from "./useChatSend";

export default function MessageBubble({ msg }: { msg: ComposerMessage }) {
  const isUser = msg.role === "user";
  const isAborted = !isUser && !msg.streaming && msg.status === "aborted";
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (isUser) return;
    setHtml(DOMPurify.sanitize(marked.parse(msg.content) as string));
  }, [isUser, msg.content]);

  // Don't render empty aborted assistant bubbles (race between abort + tool flush).
  if (isAborted && msg.content === "") return null;

  return (
    <div className={`coach-message-row ${isUser ? "user" : "assistant"}`}>
      <div
        className={`coach-message ${isUser ? "user" : "assistant"} ${
          msg.workLog ? "has-work-log" : ""
        }`}
      >
        {isUser ? (
          msg.content
        ) : (
          <>
            {msg.workLog ? (
              <CoachWorkDisclosure
                workLog={msg.workLog}
                startedAt={msg.workStartedAt}
                hasVisibleText={Boolean(msg.content)}
              />
            ) : null}
            {msg.content ? (
              <div
                className="prose-coach"
                dangerouslySetInnerHTML={{ __html: html ?? "" }}
              />
            ) : null}
            {isAborted ? (
              <span className="coach-message-stopped">(stopped)</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
