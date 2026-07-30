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

export default function MessageList({ messages }: { messages: ComposerMessage[] }) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const changeLightboxIndex = useCallback(
    (index: number) =>
      setLightbox((current) => (current ? { ...current, index } : current)),
    [],
  );

  return (
    <>
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          msg={message}
          onAttachmentClick={(attachments, attachmentIndex, trigger) =>
            setLightbox({
              attachments,
              index: attachmentIndex,
              returnFocus: trigger,
            })
          }
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
