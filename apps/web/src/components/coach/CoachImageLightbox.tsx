"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ComposerAttachment } from "./useChatSend";

type Props = {
  attachments: ComposerAttachment[];
  index: number;
  returnFocus: HTMLButtonElement | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

export default function CoachImageLightbox({
  attachments,
  index,
  returnFocus,
  onIndexChange,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const attachment = attachments[index];

  useEffect(() => {
    closeRef.current?.focus();
    return () => returnFocus?.focus();
  }, [returnFocus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && attachments.length > 1) {
        onIndexChange((index - 1 + attachments.length) % attachments.length);
      }
      if (event.key === "ArrowRight" && attachments.length > 1) {
        onIndexChange((index + 1) % attachments.length);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [attachments.length, index, onClose, onIndexChange]);

  if (!attachment) return null;

  return (
    <div
      className="coach-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Attached image ${index + 1} of ${attachments.length}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="coach-lightbox-close"
        onClick={onClose}
        aria-label="Close image viewer"
      >
        <X aria-hidden />
      </button>
      {attachments.length > 1 ? (
        <button
          type="button"
          className="coach-lightbox-previous"
          onClick={() =>
            onIndexChange(
              (index - 1 + attachments.length) % attachments.length,
            )
          }
          aria-label="Previous image"
        >
          <ChevronLeft aria-hidden />
        </button>
      ) : null}
      {/* Authenticated same-origin URLs include the session cookie. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="coach-lightbox-image"
        src={attachment.url}
        alt={`Attachment ${index + 1} of ${attachments.length}`}
      />
      {attachments.length > 1 ? (
        <button
          type="button"
          className="coach-lightbox-next"
          onClick={() => onIndexChange((index + 1) % attachments.length)}
          aria-label="Next image"
        >
          <ChevronRight aria-hidden />
        </button>
      ) : null}
      <div className="coach-lightbox-count" aria-live="polite">
        {index + 1} / {attachments.length}
      </div>
    </div>
  );
}
