"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { formatToolProgressLabel, type ComposerMessage } from "./useChatSend";

export default function MessageBubble({ msg }: { msg: ComposerMessage }) {
  const isUser = msg.role === "user";
  const html = !isUser
    ? DOMPurify.sanitize(marked.parse(msg.content) as string)
    : null;
  const progressLabel = formatToolProgressLabel(msg.progress);

  return (
    <div className={`coach-message-row ${isUser ? "user" : "assistant"}`}>
      <div className={`coach-message ${isUser ? "user" : "assistant"}`}>
        {isUser ? (
          msg.content
        ) : msg.streaming && msg.content === "" && progressLabel ? (
          <div className={`coach-tool-progress ${msg.progress?.state ?? "running"}`}>
            <span className="coach-tool-progress-dot" />
            <span>{progressLabel}</span>
          </div>
        ) : msg.streaming && msg.content === "" ? (
          <div className="coach-thinking">
            <span className="coach-thinking-dots">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="coach-thinking-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </span>
            <span className="coach-thinking-label">Thinking...</span>
          </div>
        ) : (
          <>
            <div
              className="prose-coach"
              dangerouslySetInnerHTML={{ __html: html ?? "" }}
            />
            {msg.streaming && progressLabel ? (
              <div className={`coach-tool-progress ${msg.progress?.state ?? "running"}`}>
                <span className="coach-tool-progress-dot" />
                <span>{progressLabel}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
