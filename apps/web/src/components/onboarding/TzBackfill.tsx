"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget IANA timezone capture for users who completed onboarding
 * before /api/me/tz existed (or whose initial wizard tz write was blocked).
 * Mounts once on the overview page; the server-side write-once gate
 * (`setTzIfUnset`) makes repeat calls cheap noops.
 *
 * Rendered inside the dashboard PAGE — not the layout — so this doesn't run
 * on every authenticated route hit. One write per dashboard load is enough.
 */
export default function TzBackfill() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      void fetch("/api/me/tz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tz }),
      }).catch(() => {
        // best-effort — nothing user-visible depends on success.
      });
    } catch {
      // Intl unavailable; skip silently.
    }
  }, []);
  return null;
}
