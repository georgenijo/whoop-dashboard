"use client";

import { useEffect, useState } from "react";
import type { CoachBlock } from "@/lib/db/coach-blocks";
import BlockCard from "./BlockCard";

export default function CoachBlockChain({ threadId }: { threadId: number }) {
  const [blocks, setBlocks] = useState<CoachBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/logs/coach-blocks?thread_id=${encodeURIComponent(String(threadId))}`,
          { signal: ctrl.signal, credentials: "same-origin" },
        );
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { blocks: CoachBlock[] };
        setBlocks(body.blocks);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => ctrl.abort();
  }, [threadId]);

  if (error) {
    return (
      <div style={{ padding: 12, color: "#ef4444", fontSize: 12 }}>
        Failed to load thread blocks: {error}
      </div>
    );
  }
  if (blocks == null) {
    return <div style={{ padding: 12, color: "var(--fg-3)", fontSize: 12 }}>Loading…</div>;
  }
  if (blocks.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--fg-3)", fontSize: 12 }}>
        No blocks for thread #{threadId}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 4 }}>
      {blocks.map((b, idx) => (
        <BlockCard key={`${b.ts}-${idx}`} block={b} />
      ))}
    </div>
  );
}
