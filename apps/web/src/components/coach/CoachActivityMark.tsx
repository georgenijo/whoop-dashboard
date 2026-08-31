"use client";

import type { CSSProperties } from "react";

const PIXEL_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

export default function CoachActivityMark({ active }: { active: boolean }) {
  return (
    <span
      className={`coach-activity-mark ${active ? "is-active" : "is-settled"}`}
      aria-hidden="true"
    >
      {PIXEL_DELAYS.map((delay, index) => (
        <span
          key={index}
          style={{ "--coach-pixel-delay": `${delay}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
