"use client";

import type { KeyboardEvent, RefObject } from "react";

type Props = {
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export default function ChatInput({
  input,
  setInput,
  loading,
  inputRef,
  onSubmit,
  onKeyDown,
}: Props) {
  return (
    <div className="coach-composer">
      <div className="coach-input-shell">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask about your recovery, sleep, strain..."
          rows={1}
          disabled={loading}
          className="coach-input"
        />
        <button
          type="button"
          className="coach-send"
          onClick={onSubmit}
          disabled={!input.trim() || loading}
        >
          ↑
        </button>
      </div>
      <div className="coach-footer">
        <span>Enter to send · Shift+Enter for newline</span>
        <span>{loading ? "Thinking..." : " "}</span>
      </div>
    </div>
  );
}
