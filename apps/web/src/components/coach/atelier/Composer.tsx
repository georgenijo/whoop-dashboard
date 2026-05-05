"use client";

import { useEffect, type KeyboardEvent, type RefObject } from "react";

type Props = {
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  progressLabel?: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export default function Composer({
  input,
  setInput,
  loading,
  progressLabel,
  inputRef,
  onSubmit,
  onKeyDown,
}: Props) {
  useEffect(() => {
    if (input === "" && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input, inputRef]);

  return (
    <div className="atelier-composer">
      <div className="atelier-composer-wrap">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder="Compose your inquiry..."
          rows={2}
          disabled={loading}
          className="atelier-composer-input"
        />
        <div className="atelier-composer-row">
          <span className="atelier-composer-hint">Enter to send · Shift+Enter for newline</span>
          <button
            type="button"
            className="atelier-composer-send"
            onClick={onSubmit}
            disabled={!input.trim() || loading}
            aria-label="Send message"
          >
            Send ↑
          </button>
        </div>
      </div>
      <div className="atelier-composer-footnote">
        <em>A correspondence with your body.</em>
        <span>{loading ? (progressLabel ?? "Composing...") : " "}</span>
      </div>
    </div>
  );
}
