"use client";

import { useState, type ReactNode } from "react";
import type { EventRow as EventRowData } from "@/lib/db/events";
import { SOURCE_COLORS, SOURCE_LABELS } from "./SourceChips";
import { LEVEL_COLORS } from "./LevelFilter";

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return iso;
  }
}

export default function EventRow({
  event,
  customExpand,
}: {
  event: EventRowData;
  customExpand?: (event: EventRowData) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sourceColor = SOURCE_COLORS[event.source];
  const levelColor = LEVEL_COLORS[event.level];

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "120px 90px 60px 1fr 18px",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: "var(--fg-3)" }}>{formatTs(event.ts)}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 8px",
            borderRadius: 999,
            background: `${sourceColor}22`,
            color: sourceColor,
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: sourceColor,
            }}
          />
          {SOURCE_LABELS[event.source]}
        </span>
        <span
          style={{
            color: levelColor,
            fontWeight: event.level === "fatal" ? 700 : 500,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          {event.level}
        </span>
        <span
          style={{
            color: "var(--fg-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {event.summary}
        </span>
        <span style={{ color: "var(--fg-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
          ›
        </span>
      </button>
      {open ? (
        <div style={{ padding: "0 12px 12px 12px", background: "rgba(255,255,255,0.02)" }}>
          {customExpand ? (
            customExpand(event)
          ) : (
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "rgba(0,0,0,0.3)",
                borderRadius: 6,
                color: "var(--fg-1)",
                fontSize: 11,
                overflow: "auto",
                maxHeight: 480,
              }}
            >
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
