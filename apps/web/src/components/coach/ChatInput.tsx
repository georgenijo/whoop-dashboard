"use client";

import { Paperclip, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { PendingChatImage } from "./useChatSend";

type Props = {
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  modelChanging: boolean;
  modelPicker: ReactNode;
  preparingImages: boolean;
  pendingImages: PendingChatImage[];
  attachmentError?: string | null;
  progressLabel?: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export default function ChatInput({
  input,
  setInput,
  loading,
  modelChanging,
  modelPicker,
  preparingImages,
  pendingImages,
  attachmentError,
  progressLabel,
  inputRef,
  onAddImages,
  onRemoveImage,
  onSubmit,
  onKeyDown,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const busy = loading || modelChanging;

  useEffect(() => {
    if (input === "" && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input, inputRef]);

  const addImageFiles = (files: File[]) => {
    if (files.length > 0) onAddImages(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) {
      event.preventDefault();
      if (!busy) addImageFiles(files);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;
    addImageFiles(
      Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/"),
      ),
    );
  };

  const atLimit = pendingImages.length >= 3;

  return (
    <div
      className={`coach-composer ${dragActive ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!busy) setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        const relatedTarget = event.relatedTarget;
        if (
          !(relatedTarget instanceof Node) ||
          !event.currentTarget.contains(relatedTarget)
        ) {
          setDragActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      {pendingImages.length > 0 ? (
        <>
          <div className="coach-attachment-previews" aria-label="Attached images">
            {pendingImages.map((image, index) => (
              <div className="coach-attachment-preview" key={image.id}>
                {/* The object URL is local and released by useChatSend. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={`Selected image ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(image.id)}
                  aria-label={`Remove selected image ${index + 1}`}
                  disabled={busy}
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <p className="coach-attachment-notice">
            Images are stored with this thread and sent to your selected Coach
            provider.
          </p>
          <p className="coach-medical-image-note">
            Image analysis can be wrong and isn’t a medical diagnosis.
          </p>
        </>
      ) : null}
      {attachmentError ? (
        <p className="coach-attachment-error" role="alert">
          {attachmentError}
        </p>
      ) : null}
      <div className="coach-input-shell">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            addImageFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(event) => {
            if (busy && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              return;
            }
            onKeyDown(event);
          }}
          onPaste={handlePaste}
          placeholder="Ask about your recovery, sleep, strain..."
          rows={1}
          disabled={modelChanging}
          className="coach-input"
        />
        <div className="coach-input-toolbar">
          <div className="coach-input-tools">
            <button
              type="button"
              className="coach-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || atLimit}
              aria-label="Attach images"
              aria-describedby={atLimit ? "coach-image-limit" : undefined}
              title={atLimit ? "You can attach up to 3 images." : "Attach images"}
            >
              <Paperclip size={18} strokeWidth={1.8} aria-hidden />
              <span className="sr-only">
                {pendingImages.length} of 3 images selected
              </span>
            </button>
          </div>
          <div className="coach-input-submit-controls">
            {modelPicker}
            <button
              type="button"
              className="coach-send"
              onClick={onSubmit}
              disabled={
                (!input.trim() && pendingImages.length === 0) || busy
              }
              aria-label="Send message"
              data-track="coach:send"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
      <div className="coach-footer">
        <span id="coach-image-limit">
          {atLimit
            ? "3 image limit reached"
            : "Enter to send · Shift+Enter for newline"}
        </span>
        <span>
          {modelChanging
            ? "Switching model…"
            : preparingImages
            ? "Preparing images…"
            : loading
              ? progressLabel ?? "Thinking..."
              : " "}
        </span>
      </div>
    </div>
  );
}
