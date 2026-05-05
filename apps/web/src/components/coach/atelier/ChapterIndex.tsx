"use client";

import { useState } from "react";
import { type ThreadSummary } from "@/components/coach/useCoachThread";

type Bucket = "Today" | "Yesterday" | "This week" | "Earlier";

function bucketOf(iso: string | null | undefined): Bucket {
  if (!iso) return "Earlier";
  const now = new Date();
  const d = new Date(iso);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = todayStart.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "This week";
  return "Earlier";
}

const BUCKET_ORDER: Bucket[] = ["Today", "Yesterday", "This week", "Earlier"];
const ROMAN_BUCKETS: Record<Bucket, string> = {
  Today: "I",
  Yesterday: "II",
  "This week": "III",
  Earlier: "IV",
};

const PILLS = ["All", "Recovery", "Sleep", "Strain", "Stress"] as const;

type Props = {
  threads: ThreadSummary[];
  activeId: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
};

export default function ChapterIndex({ threads, activeId, onSelect, onCreate, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [activePill, setActivePill] = useState<string>("All");

  const filtered = query.trim()
    ? threads.filter((t) => (t.title ?? "").toLowerCase().includes(query.toLowerCase()))
    : threads;

  const grouped = new Map<Bucket, ThreadSummary[]>();
  for (const bucket of BUCKET_ORDER) grouped.set(bucket, []);
  for (const t of filtered) {
    const key = bucketOf(t.updated_at);
    grouped.get(key)!.push(t);
  }

  return (
    <aside className="atelier-chapter-index">
      <div className="atelier-hist-head">
        <span className="atelier-eyebrow">Chapter Index</span>
        <h3 className="atelier-hist-title">
          A correspondence<em> with your body.</em>
        </h3>
        <button type="button" className="atelier-new-thread" onClick={onCreate}>
          + New thread
        </button>
      </div>

      <div className="atelier-hist-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="search"
          placeholder="Search threads..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="atelier-hist-filters">
        {PILLS.map((pill) => (
          <button
            key={pill}
            type="button"
            className={`atelier-pill${pill === activePill ? " active" : ""}${pill !== "All" ? " decorative" : ""}`}
            onClick={() => pill === "All" && setActivePill("All")}
          >
            {pill}
          </button>
        ))}
      </div>

      <div className="atelier-hist-list">
        {BUCKET_ORDER.map((bucket) => {
          const items = grouped.get(bucket)!;
          if (items.length === 0) return null;
          return (
            <div key={bucket}>
              <div className="atelier-hist-bucket">
                <span className="atelier-bucket-roman">{ROMAN_BUCKETS[bucket]}</span>
                <span>{bucket}</span>
              </div>
              {items.map((t) => (
                <div
                  key={t.id}
                  className={`atelier-hist-item${t.id === activeId ? " active" : ""}`}
                  onClick={() => onSelect(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(t.id)}
                >
                  <div className="atelier-hist-row1">
                    <span>{t.updated_at ? t.updated_at.slice(11, 16) : ""}</span>
                    <span>{t.message_count} msg</span>
                  </div>
                  <div className="atelier-hist-preview">
                    {t.title?.trim() || "New chat"}
                  </div>
                  {t.id === activeId && (
                    <button
                      type="button"
                      className="atelier-hist-delete"
                      onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                      aria-label="Delete thread"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="atelier-hist-empty">No threads found.</div>
        )}
      </div>
    </aside>
  );
}
