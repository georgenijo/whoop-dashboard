"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { COACH_GOAL_IDS, COACH_GOAL_LABELS } from "@/lib/coach/goals";

type Stage = "welcome" | "connect" | "sync";

type WelcomeClientProps = {
  initialStage: Stage;
  initialGoals: string[];
};

type GoalChip = { id: string; label: string };

const GOAL_CHIPS: readonly GoalChip[] = COACH_GOAL_IDS.map((id) => ({
  id,
  label: COACH_GOAL_LABELS[id],
}));

// Feature grid for Screen 1. All four colours come from the --metric-* token
// family so the dots track the dashboard's metric palette consistently.
const FEATURES: readonly {
  label: string;
  caption: string;
  colorVar: string;
}[] = [
  { label: "Recovery", caption: "HRV, RHR, score", colorVar: "var(--metric-recovery)" },
  { label: "Sleep", caption: "Stages, need, performance", colorVar: "var(--metric-sleep-deep)" },
  { label: "Strain", caption: "Day load, workouts", colorVar: "var(--metric-strain)" },
  { label: "Coach", caption: "Ask anything", colorVar: "var(--ai)" },
];

const SCREEN_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 24,
  background: "#05050a",
  color: "var(--fg-0, #f5f5f7)",
  fontFamily:
    "var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)",
  padding: 24,
};

const HEADING_STYLE: CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: -0.4,
  textAlign: "center",
};

const SUBHEADING_STYLE: CSSProperties = {
  fontSize: 14,
  opacity: 0.65,
  maxWidth: 360,
  textAlign: "center",
  lineHeight: 1.5,
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "12px 20px",
  background: "#000",
  color: "#fff",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: "none",
  border: "1px solid rgba(255,255,255,0.18)",
  minWidth: 220,
  cursor: "pointer",
};

const SECONDARY_BTN_STYLE: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-2, #a1a1aa)",
  fontSize: 13,
  cursor: "pointer",
  padding: "8px 12px",
};

export default function WelcomeClient({
  initialStage,
  initialGoals,
}: WelcomeClientProps) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [goals, setGoals] = useState<Set<string>>(new Set(initialGoals));

  // Fire-and-forget tz capture. Runs once on first mount of the wizard so we
  // get the IANA name before the user clicks anything. setTzIfUnset is the
  // server-side write-once gate; repeated POSTs are idempotent.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      // intentional: wizard never blocks; tz capture is best-effort.
      void fetch("/api/me/tz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tz }),
      }).catch(() => {});
    } catch {
      // Intl unavailable (extremely old runtime); skip silently.
    }
  }, []);

  // Wrapped in useCallback so the auto-kick useEffect below has a stable ref
  // and the linter can see the dependency chain. The wizard never blocks on
  // sync failure — the finally clause redirects to "/" regardless so a
  // transient error doesn't trap the user on this screen. Sync errors are
  // recoverable from /settings later.
  const runSync = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/sync/onboarding", { method: "POST" });
    } catch {
      // swallow — the redirect below is the user-visible end state.
    } finally {
      // intentional: wizard never blocks; onboarded stamp is best-effort.
      await fetch("/api/me/onboarded", { method: "POST" }).catch(() => {});
      // Full reload required to cross out of the (onboarding) route group.
      window.location.href = "/";
    }
  }, []);

  // Sync auto-kicks when the user lands on (or transitions to) the sync
  // stage. Guard is session-scoped so strict-mode double-mount doesn't
  // double-fire — useRef re-initialises on the second mount in dev, but
  // sessionStorage is shared across both. The redirect to "/" leaves this
  // tab's onboarding context entirely; re-navigating to /welcome?stage=sync
  // in the same tab without an intervening tab close intentionally skips
  // the sync (matches "I already did this" semantics).
  useEffect(() => {
    if (stage !== "sync") return;
    const key = "welcome:sync-fired";
    if (sessionStorage.getItem(key) === "1") return;
    // Set BEFORE awaiting so strict-mode's second mount sees the flag.
    sessionStorage.setItem(key, "1");
    void runSync();
  }, [stage, runSync]);

  function toggleGoal(id: string): void {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleContinueFromWelcome(): Promise<void> {
    // Persist the chosen goals BEFORE moving on — if the user closes the tab
    // mid-wizard we still capture preferences.
    // intentional: wizard never blocks; goals are best-effort.
    await fetch("/api/me/coach-goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goals: [...goals] }),
    }).catch(() => {});
    setStage("connect");
  }

  async function handleSkipConnect(): Promise<void> {
    // intentional: wizard never blocks; onboarded stamp is best-effort.
    await fetch("/api/me/onboarded", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  if (stage === "welcome") {
    return (
      <div style={SCREEN_STYLE}>
        <div style={HEADING_STYLE}>
          whoop<span style={{ color: "var(--brand-strain)" }}>+</span>
        </div>
        <div style={SUBHEADING_STYLE}>
          Your Whoop data, deeper. Trends, PRs, and a coach that answers in
          plain English.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(140px, 1fr))",
            gap: 10,
            maxWidth: 360,
            width: "100%",
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: f.colorVar,
                  flexShrink: 0,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</span>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{f.caption}</span>
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            fontSize: 12,
            opacity: 0.55,
            marginTop: 4,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          What matters most to you?
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            maxWidth: 360,
          }}
        >
          {GOAL_CHIPS.map((chip) => {
            const selected = goals.has(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => toggleGoal(chip.id)}
                aria-pressed={selected}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  fontSize: 13,
                  cursor: "pointer",
                  background: selected ? "var(--ai)" : "transparent",
                  color: selected ? "#fff" : "var(--fg-1, #e7e7ea)",
                  border: selected
                    ? "1px solid var(--ai)"
                    : "1px solid rgba(255,255,255,0.18)",
                  transition: "background 120ms ease, border-color 120ms ease",
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void handleContinueFromWelcome()}
          style={PRIMARY_BTN_STYLE}
        >
          Continue
        </button>
      </div>
    );
  }

  if (stage === "connect") {
    return (
      <div style={SCREEN_STYLE}>
        <div style={HEADING_STYLE}>Connect your Whoop</div>
        <div style={SUBHEADING_STYLE}>
          We&apos;ll pull your last 7 days of recovery, sleep, strain, and
          workouts. Takes about 30 seconds.
        </div>
        {/* Full-document navigation is the desired behaviour — /api/auth/login
            returns a 302 to Whoop. An anchor (not router.push) ensures the
            browser follows the redirect cleanly across the route group. */}
        <a href="/api/auth/login" style={PRIMARY_BTN_STYLE}>
          Connect Whoop
        </a>
        <button
          type="button"
          onClick={() => void handleSkipConnect()}
          style={SECONDARY_BTN_STYLE}
        >
          I&apos;ll do this later &rarr;
        </button>
      </div>
    );
  }

  // stage === "sync"
  return (
    <div style={SCREEN_STYLE}>
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          border: "3px solid rgba(255,255,255,0.15)",
          borderTopColor: "var(--ai)",
          borderRadius: "50%",
          animation: "welcome-spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes welcome-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={HEADING_STYLE}>Syncing your last 7 days…</div>
      <div style={SUBHEADING_STYLE}>
        This usually takes about 30 seconds. You&apos;ll land on your
        dashboard when it&apos;s done.
      </div>
    </div>
  );
}
