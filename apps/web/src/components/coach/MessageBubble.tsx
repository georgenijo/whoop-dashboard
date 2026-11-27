"use client";

import { renderMarkdownToSafeHtml } from "@/lib/render-markdown";
import { parseCoachVisualizations } from "@/lib/coach/visualization";
import dynamic from "next/dynamic";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { useFrameThrottledValue } from "./useFrameThrottledValue";
import CoachWorkDisclosure from "./CoachWorkDisclosure";
import CoachPresentationBlocks from "./CoachPresentationBlocks";
import CoachMessageActions from "./CoachMessageActions";
import { COACH_ERROR_COPY } from "./chat-errors";
import type { BubbleMessage, ComposerAttachment } from "./useChatSend";

// Recharts is fetched only once a reply actually contains an inline chart.
const CoachInlineChart = dynamic(() => import("./CoachInlineChart"), {
  loading: () => <div className="coach-inline-chart is-loading" aria-busy="true" />,
});

type Props = {
  msg: BubbleMessage;
  onAttachmentClick?: (
    attachments: ComposerAttachment[],
    index: number,
    trigger: HTMLButtonElement,
  ) => void;
  /** Present only on the latest failed reply. */
  onRetry?: () => void;
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

function MessageBubble({ msg, onAttachmentClick, onRetry }: Props) {
  const isUser = msg.role === "user";
  const isBrowser = useSyncExternalStore(
    subscribeToBrowser,
    browserSnapshot,
    serverSnapshot,
  );
  // A bubble first rendered after hydration arrived during this visit (a sent
  // message or a reply) and springs in; the server-rendered
  // transcript is already on screen and stays still. Captured once, so later
  // streaming re-renders never replay the entrance.
  const [entering] = useState(isBrowser);
  const isAborted = !isUser && !msg.streaming && msg.status === "aborted";
  // Parsing + sanitizing the whole message is the expensive part of a
  // streamed delta, so a streaming bubble re-renders it at most once per
  // animation frame; a finished message renders its final text at once.
  const content = useFrameThrottledValue(msg.content, Boolean(msg.streaming));
  const contentSegments = useMemo(
    () =>
      isUser || !isBrowser
        ? [{ type: "markdown" as const, content }]
        : parseCoachVisualizations(content),
    [content, isBrowser, isUser],
  );
  const hasInlineChart = contentSegments.some(
    (segment) => segment.type === "chart",
  );
  // Every assistant fragment goes through `renderMarkdownToSafeHtml`
  // (marked + DOMPurify); nothing model-authored reaches the DOM unsanitized.
  const html = useMemo(() => {
    if (isUser || !isBrowser || hasInlineChart) return null;
    return renderMarkdownToSafeHtml(content);
  }, [content, hasInlineChart, isBrowser, isUser]);
  const segmentHtml = useMemo(
    () =>
      hasInlineChart
        ? contentSegments.map((segment) =>
            segment.type === "chart"
              ? null
              : (renderMarkdownToSafeHtml(segment.content) ?? ""),
          )
        : [],
    [contentSegments, hasInlineChart],
  );

  // Don't render empty aborted assistant bubbles (race between abort + tool
  // flush) -- unless a tool call already moved visible text into work notes.
  if (isAborted && msg.content === "" && !msg.workLog?.notes.length) return null;

  return (
    <div className={`coach-message-row ${isUser ? "user" : "assistant"}${entering ? " is-entering" : ""}`}>
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
              hasInlineChart ? (
                <div
                  className={`prose-coach ${msg.streaming ? "is-streaming" : ""}`}
                  aria-busy={msg.streaming || undefined}
                >
                  {contentSegments.map((segment, index) =>
                    segment.type === "chart" ? (
                      <CoachInlineChart
                        chart={segment.chart}
                        key={`chart:${index}:${segment.chart.title}`}
                      />
                    ) : (
                      <div
                        className="coach-markdown-segment"
                        // Every fragment passes through the same sanitizer as a
                        // normal assistant message. Chart extraction never
                        // turns model-authored markup into executable content.
                        dangerouslySetInnerHTML={{
                          __html: segmentHtml[index] ?? "",
                        }}
                        key={`markdown:${index}`}
                      />
                    ),
                  )}
                </div>
              ) : html !== null ? (
                <div
                  className={`prose-coach ${msg.streaming ? "is-streaming" : ""}`}
                  aria-busy={msg.streaming || undefined}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <div
                  className={`prose-coach coach-markdown-fallback ${
                    msg.streaming ? "is-streaming" : ""
                  }`}
                  aria-busy={msg.streaming || undefined}
                >
                  {content}
                </div>
              )
            ) : null}
            {msg.streaming && msg.content ? (
              <span className="sr-only" role="status">
                Coach is writing
              </span>
            ) : null}
            {!msg.streaming ? (
              <CoachPresentationBlocks blocks={msg.presentationBlocks ?? []} />
            ) : null}
            {isAborted ? (
              <span className="coach-message-stopped">(stopped)</span>
            ) : null}
            {msg.error ? (
              <div className="coach-message-error" role="alert">
                <p className="coach-message-error-title">
                  {COACH_ERROR_COPY[msg.error.errorClass].title}
                </p>
                <p className="coach-message-error-detail">
                  {msg.error.detail ?? COACH_ERROR_COPY[msg.error.errorClass].hint}
                </p>
                {onRetry ? (
                  <button
                    type="button"
                    className="coach-message-retry"
                    onClick={onRetry}
                    data-track="coach:retry"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            {!msg.streaming && (msg.content.trim() || msg.presentationBlocks?.length) ? (
              <CoachMessageActions text={[
                msg.content.trim(),
                ...(msg.presentationBlocks ?? []).map((block) => block.fallback),
              ].filter(Boolean).join("\n\n")} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// Memoized: in a long thread only the streaming bubble (whose `msg` object
// changes per delta) re-renders; settled messages keep their identity.
export default memo(MessageBubble);
