"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Stage = "welcome" | "connect" | "sync";

type WelcomeClientProps = {
  initialStage: Stage;
  initialGoals: string[];
};

type GoalChip = { id: string; label: string };

// Order is intentional: the four goals appear left-to-right top-to-bottom in
// a 2x2 grid. Sleep + recovery (the "passive" goals) precede train + stress
// (the "active" goals) — matches how most users frame their priorities.
const GOAL_CHIPS: readonly GoalChip[] = [
  { id: "sleep_better", label: "Sleep better" },
  { id: "recover_faster", label: "Recover faster" },
  { id: "train_smarter", label: "Train smarter" },
  { id: "manage_stress", label: "Manage stress" },
];

// Feature grid for Screen 1. Colours pull from existing --metric-* / --brand-*
// / --ai tokens in theme.css — no new design tokens introduced.
const FEATURES: readonly {
  label: string;
  caption: string;
  colorVar: string;
}[] = [
  { label: "Recovery", caption: "HRV, RHR, score", colorVar: "var(--metric-recovery)" },
  { label: "Sleep", caption: "Stages, need, performance", colorVar: "var(--metric-sleep-deep)" },
  { label: "Strain", caption: "Day load, workouts", colorVar: "var(--brand-strain)" },
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
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Fire-and-forget tz capture. Runs once on first mount of the wizard so we
  // get the IANA name before the user clicks anything. setTzIfUnset is the
  // server-side write-once gate; repeated POSTs are idempotent.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      void fetch("/api/me/tz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tz }),
      }).catch(() => {
        // Wizard never blocks on tz failure — write-once is best-effort.
      });
    } catch {
      // Intl unavailable (extremely old runtime); skip silently.
    }
  }, []);

  // Sync auto-kicks when the user lands on (or transitions to) the sync
  // stage. The `syncing` guard prevents a re-render from re-firing the sync —
  // and once `syncing` flips back to false (only happens in error paths we
  // surface), we DON'T retry because runSync's finally block redirects away.
  useEffect(() => {
    if (stage !== "sync") return;
    if (syncing) return;
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function runSync(): Promise<void> {
    setSyncing(true);
    setSyncError(null);
    try {
      const resp = await fetch("/api/sync/onboarding", { method: "POST" });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!j.ok) setSyncError(j.error ?? "sync_failed");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "sync_failed");
    } finally {
      // Stamp onboarded regardless of sync outcome — the user has been
      // through the wizard, and we don't want a transient sync error to trap
      // them here on every page load. Fire-and-forget; the redirect below is
      // the user-visible end state.
      await fetch("/api/me/onboarded", { method: "POST" }).catch(() => {});
      // Full reload required to cross out of the (onboarding) route group.
      window.location.href = "/";
    }
  }

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
    // mid-wizard we still capture preferences. fire-and-forget on failure.
    await fetch("/api/me/coach-goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goals: [...goals] }),
    }).catch(() => {});
    setStage("connect");
  }

  async function handleSkipConnect(): Promise<void> {
    await fetch("/api/me/onboarded", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  if (stage === "welcome") {
    return (
      <div style={SCREEN_STYLE}>
        <div style={HEADING_STYLE}>
          whoop<span style={{ color: "var(--ai)" }}>+</span>
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
      {syncError && (
        <div
          role="alert"
          style={{
            maxWidth: 360,
            textAlign: "center",
            fontSize: 12,
            color: "#ff8b8b",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.25)",
            padding: "10px 14px",
            borderRadius: 8,
          }}
        >
          Sync hit an error ({syncError}). Continuing to your dashboard — you
          can retry from Settings.
        </div>
      )}
    </div>
  );
}
