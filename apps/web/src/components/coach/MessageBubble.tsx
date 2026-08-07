"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useSyncExternalStore } from "react";
import CoachWorkDisclosure from "./CoachWorkDisclosure";
import type {
  ComposerAttachment,
  ComposerMessage,
} from "./useChatSend";

type Props = {
  msg: ComposerMessage;
  onAttachmentClick?: (
    attachments: ComposerAttachment[],
    index: number,
    trigger: HTMLButtonElement,
  ) => void;
};

const subscribeToBrowser = (notify: () => void) => {
  const timeout = window.setTimeout(notify, 0);
  return () => window.clearTimeout(timeout);
};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

export default function MessageBubble({ msg, onAttachmentClick }: Props) {
  const isUser = msg.role === "user";
  const isBrowser = useSyncExternalStore(
    subscribeToBrowser,
    browserSnapshot,
    serverSnapshot,
  );
  const isAborted = !isUser && !msg.streaming && msg.status === "aborted";
  const html = useMemo(() => {
    if (isUser || !isBrowser) return null;
    return DOMPurify.sanitize(marked.parse(msg.content) as string);
  }, [isBrowser, isUser, msg.content]);

  // Don't render empty aborted assistant bubbles (race between abort + tool flush).
  if (isAborted && msg.content === "") return null;

  return (
    <div className={`coach-message-row ${isUser ? "user" : "assistant"}`}>
      <span className="coach-speaker">{isUser ? "You" : "Coach"}</span>
      <div
        className={`coach-message ${isUser ? "user" : "assistant"} ${
          msg.workLog ? "has-work-log" : ""
        }`}
      >
        {isUser ? (
          <>
            {msg.attachments && msg.attachments.length > 0 ? (
              <div className="coach-message-attachments">
                {msg.attachments.map((attachment, index) => (
                  <button
                    type="button"
                    className="coach-message-thumbnail"
                    key={attachment.id}
                    onClick={(event) =>
                      onAttachmentClick?.(
                        msg.attachments ?? [],
                        index,
                        event.currentTarget,
                      )
                    }
                    aria-label={`Open attached image ${index + 1} of ${
                      msg.attachments?.length ?? 0
                    }`}
                  >
                    {/* Authenticated same-origin URLs include the session cookie. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.url}
                      alt={`Attachment ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {msg.content ? (
              <div className="coach-user-message-text">{msg.content}</div>
            ) : null}
          </>
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
              isBrowser ? (
                <div
                  className="prose-coach"
                  dangerouslySetInnerHTML={{ __html: html ?? "" }}
                />
              ) : (
                <div className="prose-coach coach-markdown-fallback">
                  {msg.content}
                </div>
              )
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
