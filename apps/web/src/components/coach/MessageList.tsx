"use client";

import { useCallback, useState } from "react";
import CoachImageLightbox from "./CoachImageLightbox";
import MessageBubble from "./MessageBubble";
import type { ComposerMessage } from "./useCoachThread";
import type { ComposerAttachment } from "./useChatSend";

type LightboxState = {
  attachments: ComposerAttachment[];
  index: number;
  returnFocus: HTMLButtonElement | null;
};

export default function MessageList({
  messages,
  onRetry,
}: {
  messages: ComposerMessage[];
  /** Offered on the last message when it is a failed reply. */
  onRetry?: () => void;
}) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const openLightbox = useCallback(
    (
      attachments: ComposerAttachment[],
      index: number,
      trigger: HTMLButtonElement,
    ) => setLightbox({ attachments, index, returnFocus: trigger }),
    [],
  );
  const changeLightboxIndex = useCallback(
    (index: number) =>
      setLightbox((current) => (current ? { ...current, index } : current)),
    [],
  );

  return (
    <>
      {messages.map((message, index) => (
        <MessageBubble
          // Stable per message (db id, or a local id while optimistic), so a
          // streamed delta re-renders only the streaming bubble and inserting
          // or dropping a turn never remounts its neighbours.
          key={message.clientId}
          msg={message}
          onRetry={
            index === messages.length - 1 &&
            message.error &&
            message.error.retryable !== false
              ? onRetry
              : undefined
          }
          onAttachmentClick={openLightbox}
        />
      ))}
      {lightbox ? (
        <CoachImageLightbox
          attachments={lightbox.attachments}
          index={lightbox.index}
          returnFocus={lightbox.returnFocus}
          onIndexChange={changeLightboxIndex}
          onClose={closeLightbox}
        />
      ) : null}
    </>
  );
}
