"use client";

import { useState, type ReactNode } from "react";
import type { CoachBlock } from "@/lib/db/coach-blocks";

const STYLE: Record<
  CoachBlock["type"],
  { bg: string; border: string; label: string; labelColor: string }
> = {
  user_text: {
    bg: "rgba(148,163,184,0.08)",
    border: "rgba(148,163,184,0.25)",
    label: "User",
    labelColor: "#cbd5e1",
  },
  assistant_text: {
    bg: "rgba(96,165,250,0.08)",
    border: "rgba(96,165,250,0.25)",
    label: "Assistant",
    labelColor: "#60a5fa",
  },
  thinking: {
    bg: "rgba(167,139,250,0.06)",
    border: "rgba(167,139,250,0.2)",
    label: "Thinking",
    labelColor: "#a78bfa",
  },
  tool_use: {
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.3)",
    label: "Tool",
    labelColor: "#f59e0b",
  },
  tool_result: {
    bg: "rgba(16,185,129,0.06)",
    border: "rgba(16,185,129,0.25)",
    label: "Result",
    labelColor: "#10b981",
  },
};

function Shell({
  type,
  ts,
  header,
  defaultOpen = true,
  collapsible = false,
  children,
}: {
  type: CoachBlock["type"];
  ts: string;
  header?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const style = STYLE[type];
  return (
    <div
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 8,
        padding: 10,
        fontSize: 12,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: open ? 8 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              color: style.labelColor,
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {style.label}
          </span>
          {header}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {new Date(ts).toLocaleTimeString(undefined, { hour12: false })}
          </span>
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--fg-3)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              aria-expanded={open}
            >
              {open ? "Hide" : "Show"}
            </button>
          ) : null}
        </div>
      </div>
      {open ? children : null}
    </div>
  );
}

function Pre({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        background: "rgba(0,0,0,0.3)",
        borderRadius: 6,
        color: "var(--fg-1)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        overflow: "auto",
        maxHeight,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {children}
    </pre>
  );
}

export default function BlockCard({ block }: { block: CoachBlock }) {
  if (block.type === "user_text") {
    return (
      <Shell type="user_text" ts={block.ts}>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--fg-1)" }}>{block.content}</div>
      </Shell>
    );
  }
  if (block.type === "assistant_text") {
    return (
      <Shell type="assistant_text" ts={block.ts}>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--fg-1)" }}>{block.content}</div>
      </Shell>
    );
  }
  if (block.type === "thinking") {
    return (
      <Shell type="thinking" ts={block.ts} collapsible defaultOpen={false}>
        <div
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--fg-2)",
            fontStyle: "italic",
            opacity: 0.8,
          }}
        >
          {block.content}
        </div>
      </Shell>
    );
  }
  if (block.type === "tool_use") {
    return (
      <Shell
        type="tool_use"
        ts={block.ts}
        header={
          <span style={{ color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {block.tool_name}
          </span>
        }
      >
        <Pre>{JSON.stringify(block.tool_input, null, 2)}</Pre>
      </Shell>
    );
  }
  // tool_result
  const lines = block.content.split("\n").length;
  return (
    <Shell
      type="tool_result"
      ts={block.ts}
      collapsible={lines > 30}
      defaultOpen={lines <= 30}
      header={
        <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
          {block.tool_use_id.slice(0, 12)}…
        </span>
      }
    >
      <Pre maxHeight={lines > 30 ? 320 : undefined}>{block.content}</Pre>
    </Shell>
  );
}
