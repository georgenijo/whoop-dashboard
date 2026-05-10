"use client";

import { type ReactNode, useId, useState } from "react";

type CollapsibleCardProps = {
  title: string;
  sub: string;
  defaultOpen: boolean;
  children: ReactNode;
};

export default function CollapsibleCard({ title, sub, defaultOpen, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        className="card-head"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          marginBottom: 0,
          padding: "16px 20px",
          border: 0,
          borderBottom: open ? "1px solid rgba(255,255,255,0.05)" : 0,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <div>
          <div className="card-title">{title}</div>
          <span className="card-sub">{sub}</span>
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          style={{
            width: 16,
            height: 16,
            flex: "0 0 auto",
            color: "var(--fg-3)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform var(--dur-base)",
          }}
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </button>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
