"use client";

import { useState } from "react";

export default function SyncSection() {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setLastResult(null);
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const d = await r.json();
      setLastResult(d.message ?? (r.ok ? "Sync complete." : "Sync failed."));
    } catch {
      setLastResult("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="atelier-sync-section">
      <div className="atelier-sec-rule">
        <span className="atelier-sec-roman">II.</span>
        <span className="atelier-sec-title">Data &amp; Sync</span>
      </div>
      <div className="atelier-placeholder-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="atelier-coach-label">Last 7 days</div>
          <div className="atelier-coach-sub">Pulls recovery, sleep, strain, and workouts from Whoop.</div>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="atelier-sync-btn"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {lastResult && (
        <div className="atelier-sync-result">{lastResult}</div>
      )}
    </section>
  );
}
