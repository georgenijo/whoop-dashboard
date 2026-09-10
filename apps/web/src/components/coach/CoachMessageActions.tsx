"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

type Feedback =
  | { kind: "idle" }
  | { kind: "copied"; action: "copy" | "share" }
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
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  function clearCopiedTimeout() {
    if (copiedTimeout.current === null) return;
    window.clearTimeout(copiedTimeout.current);
    copiedTimeout.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      busyRef.current = false;
      clearCopiedTimeout();
    };
  }, []);

  function resetFeedback() {
    clearCopiedTimeout();
    setFeedback({ kind: "idle" });
  }

  function beginOperation(): boolean {
    if (busyRef.current || !mounted.current) return false;
    busyRef.current = true;
    resetFeedback();
    setBusy(true);
    return true;
  }

  function finishOperation() {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  }

  function showCopied(action: "copy" | "share") {
    if (!mounted.current) return;
    clearCopiedTimeout();
    setFeedback({ kind: "copied", action });
    copiedTimeout.current = window.setTimeout(() => {
      copiedTimeout.current = null;
      if (mounted.current) setFeedback({ kind: "idle" });
    }, COPIED_DURATION_MS);
  }

  function showError(message: string) {
    if (mounted.current) setFeedback({ kind: "error", message });
  }

  async function copyAnswer() {
    if (!beginOperation()) return;
    try {
      if (!await writeToClipboard(text)) throw new Error("Clipboard unavailable");
      showCopied("copy");
    } catch {
      showError("Couldn't copy. Try again.");
    } finally {
      finishOperation();
    }
  }

  async function shareAnswer() {
    if (!beginOperation()) return;

    try {
      if (!navigator.share) {
        if (!await writeToClipboard(text)) throw new Error("Clipboard unavailable");
        showCopied("share");
        return;
      }

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
    } finally {
      finishOperation();
    }
  }

  const copiedAction = feedback.kind === "copied" ? feedback.action : null;

  return (
    <div className="coach-message-actions" role="group" aria-label="Message actions">
      <button
        type="button"
        className="coach-message-action"
        disabled={busy}
        onClick={() => { void copyAnswer(); }}
      >
        {copiedAction === "copy" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        {copiedAction === "copy" ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className="coach-message-action"
        disabled={busy}
        onClick={() => { void shareAnswer(); }}
      >
        {copiedAction === "share" ? <Check aria-hidden="true" size={16} /> : <Share2 aria-hidden="true" size={16} />}
        {copiedAction === "share" ? "Copied" : "Share"}
      </button>
      <span className="coach-message-action-status" role="status">
        {feedback.kind === "error" ? feedback.message : null}
        {feedback.kind === "copied" ? <span className="sr-only">Copied to clipboard</span> : null}
      </span>
    </div>
  );
}
