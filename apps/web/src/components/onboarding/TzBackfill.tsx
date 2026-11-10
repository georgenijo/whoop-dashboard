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
export default function TzBackfill({ userId }: { userId: number }) {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      // Per account: a shared browser profile must not let one user's marker
      // suppress another user's backfill.
      const key = `whoop-dashboard:timezone:${userId}`;
      try {
        if (window.localStorage.getItem(key) === tz) return;
      } catch {
        // Storage can be unavailable (private mode or a restrictive browser).
        // Continue with the best-effort request in that case.
      }
      void fetch("/api/me/tz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tz }),
      }).then((res) => {
        // Only a successful write counts; a 401/500 must retry next load.
        if (!res.ok) return;
        try { window.localStorage.setItem(key, tz); } catch { /* best-effort */ }
      }).catch(() => { /* best-effort — nothing user-visible depends on success. */ });
    } catch {
      // Intl unavailable; skip silently.
    }
  }, [userId]);
  return null;
}
