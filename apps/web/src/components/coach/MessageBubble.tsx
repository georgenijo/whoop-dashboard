"use client";

import { renderMarkdownToSafeHtml } from "@/lib/render-markdown";
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

// Markdown is rendered only after hydration. `dompurify` has no usable
// `sanitize` without a `window`, so the server pass renders the message as
// escaped plain text through normal React instead (see `render-markdown.ts`).
// `useSyncExternalStore` — rather than an effect — is what keeps the hydration
// pass byte-identical to the server pass; the swap happens on the tick after.
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
    return renderMarkdownToSafeHtml(msg.content);
  }, [isBrowser, isUser, msg.content]);

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
            {/* `html` is non-null only when DOMPurify actually ran. Branching on
                it rather than on `isBrowser` keeps the two in lockstep: a
                sanitizer that failed closed degrades to text instead of
                blanking the message. */}
            {msg.content ? (
              html !== null ? (
                <div
                  className="prose-coach"
                  dangerouslySetInnerHTML={{ __html: html }}
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
