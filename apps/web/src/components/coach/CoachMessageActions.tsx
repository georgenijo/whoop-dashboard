"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

type Feedback =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "error"; message: string };

const COPIED_DURATION_MS = 1_500;

function copyWithSelection(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  return copyWithSelection(text);
}

async function createSummaryFile(text: string): Promise<File | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1_200;
    canvas.height = 630;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#f4f0e8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#171714";
    context.font = "600 32px system-ui";
    context.fillText("Coach summary", 72, 88);
    context.font = "400 27px system-ui";

    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const candidate = `${line} ${word}`.trim();
      if (line && context.measureText(candidate).width > 1_050) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 9).forEach((item, index) => {
      context.fillText(item, 72, 155 + index * 45);
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    return blob
      ? new File([blob], "coach-summary.png", { type: "image/png" })
      : null;
  } catch {
    return null;
  }
}

function isShareCancellation(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "AbortError";
  return error instanceof Error && error.name === "AbortError";
}

export default function CoachMessageActions({ text }: { text: string }) {
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const copiedTimeout = useRef<number | null>(null);
  const mounted = useRef(true);

  function clearCopiedTimeout() {
    if (copiedTimeout.current === null) return;
    window.clearTimeout(copiedTimeout.current);
    copiedTimeout.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearCopiedTimeout();
    };
  }, []);

  function resetFeedback() {
    clearCopiedTimeout();
    setFeedback({ kind: "idle" });
  }

  function showCopied() {
    if (!mounted.current) return;
    clearCopiedTimeout();
    setFeedback({ kind: "copied" });
    copiedTimeout.current = window.setTimeout(() => {
      copiedTimeout.current = null;
      setFeedback({ kind: "idle" });
    }, COPIED_DURATION_MS);
  }

  function showError(message: string) {
    if (mounted.current) setFeedback({ kind: "error", message });
  }

  async function copyAnswer() {
    resetFeedback();
    try {
      if (!await writeToClipboard(text)) throw new Error("Clipboard unavailable");
      showCopied();
    } catch {
      showError("Couldn't copy. Try again.");
    }
  }

  async function shareAnswer() {
    resetFeedback();
    if (!navigator.share) {
      await copyAnswer();
      return;
    }

    try {
      const file = await createSummaryFile(text);
      if (!mounted.current) return;
      if (file && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: "Coach summary", text, files: [file] });
      } else {
        await navigator.share({ title: "Coach summary", text });
      }
    } catch (error: unknown) {
      if (!isShareCancellation(error)) {
        showError("Couldn't share. Try again.");
      }
    }
  }

  const copied = feedback.kind === "copied";

  return (
    <div className="coach-message-actions" role="group" aria-label="Message actions">
      <button
        type="button"
        className="coach-message-action"
        onClick={() => { void copyAnswer(); }}
      >
        {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className="coach-message-action"
        onClick={() => { void shareAnswer(); }}
      >
        <Share2 aria-hidden="true" size={16} />
        Share
      </button>
      {feedback.kind === "error" ? (
        <span className="coach-message-action-status" role="status">
          {feedback.message}
        </span>
      ) : null}
    </div>
  );
}
