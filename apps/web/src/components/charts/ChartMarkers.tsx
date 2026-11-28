"use client";

import { useId, useMemo, useState } from "react";
import {
  MARKER_CATEGORIES,
  placeMarkers,
  type ChartMarker,
  type MarkerCategory,
  type MarkerKind,
  type MarkerSize,
  type PlacedMarker,
} from "@/lib/analytics/chartMarkers";

/**
 * Event-marker lane + legend toggles under a trend chart (CHART_MARKERS=1).
 * Each category has its own row, so a workout and a big drop on the same day
 * never overlap; each kind has its own shape and a text label, so nothing is
 * conveyed by colour alone. Markers are buttons: Tab reaches each one, focus or
 * hover shows the tooltip, and the aria-label carries the same sentence.
 */

// ~10px on a 400px-wide chart: closer neighbours in one lane merge.
const MIN_GAP_PCT = 2.5;

const KIND_TEXT: Record<MarkerKind, string> = {
  workout: "Workout",
  "high-strain": "High-strain day",
  journal: "Journal",
  drop: "Big drop",
};

const KIND_COLOR: Record<MarkerKind, string> = {
  workout: "#4da3ff",
  "high-strain": "#ff9f43",
  journal: "#c9a7ff",
  drop: "#ff5c5c",
};

const SIZE_PX: Record<MarkerSize, number> = { sm: 8, md: 11, lg: 14 };

export function MarkerShape({ kind, px }: { kind: MarkerKind; px: number }) {
  const color = KIND_COLOR[kind];
  const common = { fill: color, stroke: "rgba(5,5,10,0.9)", strokeWidth: 1 };
  return (
    <svg width={px} height={px} viewBox="0 0 12 12" aria-hidden focusable="false" style={{ display: "block" }}>
      {kind === "workout" && <polygon points="6,1 11,11 1,11" {...common} />}
      {kind === "high-strain" && <polygon points="6,0.5 11.5,6 6,11.5 0.5,6" {...common} />}
      {kind === "journal" && <rect x="1.5" y="1.5" width="9" height="9" rx="1" {...common} />}
      {kind === "drop" && <polygon points="1,1 11,1 6,11" {...common} />}
    </svg>
  );
}

type Props = {
  markers: ChartMarker[];
  /** Dates of the chart's plotted (non-null) points, in plot order. */
  plottedDates: string[];
  /** Matches the chart body's left padding (TrendChart's y-axis gutter). */
  insetLeft?: number;
  /** Chart name, for the group label ("Recovery score events"). */
  chartLabel: string;
};

export default function ChartMarkers({ markers, plottedDates, insetLeft = 0, chartLabel }: Props) {
  const [hidden, setHidden] = useState<ReadonlySet<MarkerCategory>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const tipId = useId();

  const placed = useMemo(
    () => placeMarkers(markers, plottedDates, { hidden, minGapPct: MIN_GAP_PCT }),
    [markers, plottedDates, hidden],
  );
  const counts = useMemo(() => {
    const all = placeMarkers(markers, plottedDates);
    return Object.fromEntries(
      MARKER_CATEGORIES.map(({ key }) => [key, all.filter((m) => m.category === key).length]),
    ) as Record<MarkerCategory, number>;
  }, [markers, plottedDates]);

  const toggle = (key: MarkerCategory) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const keyOf = (m: PlacedMarker) => `${m.category}-${m.date}`;
  const activeMarker = placed.find((m) => keyOf(m) === active) ?? null;
  const visibleLanes = MARKER_CATEGORIES.filter(({ key }) => !hidden.has(key) && counts[key] > 0);

  return (
    <div className="chart-markers" data-testid="chart-markers" style={{ marginTop: 6 }}>
      <div
        role="group"
        aria-label={`${chartLabel} event markers`}
        style={{ position: "relative", paddingLeft: insetLeft }}
        onMouseLeave={() => setActive(null)}
      >
        {visibleLanes.map(({ key, label }) => (
          <div
            key={key}
            data-lane={key}
            role="group"
            aria-label={`${label} markers`}
            style={{ position: "relative", height: 16 }}
          >
            {placed
              .filter((m) => m.category === key)
              .map((m) => {
                const px = SIZE_PX[m.size];
                const isActive = keyOf(m) === active;
                return (
                  <button
                    key={keyOf(m)}
                    type="button"
                    data-marker-kind={m.kind}
                    data-marker-date={m.date}
                    aria-label={m.label}
                    aria-describedby={isActive ? tipId : undefined}
                    onMouseEnter={() => setActive(keyOf(m))}
                    onFocus={() => setActive(keyOf(m))}
                    onBlur={() => setActive(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setActive(null);
                    }}
                    style={{
                      position: "absolute",
                      left: `${m.xPct}%`,
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      width: Math.max(px + 6, 16),
                      height: 16,
                      padding: 0,
                      display: "grid",
                      placeItems: "center",
                      background: "transparent",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      outlineOffset: 1,
                      boxShadow: isActive ? `0 0 0 1px ${KIND_COLOR[m.kind]}66` : undefined,
                    }}
                  >
                    <MarkerShape kind={m.kind} px={px} />
                    {m.count > 1 && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          right: -4,
                          top: -3,
                          fontFamily: "var(--font-mono)",
                          fontSize: 8,
                          color: "var(--fg-2)",
                        }}
                      >
                        {m.count}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}

        {activeMarker && (
          <div
            id={tipId}
            role="tooltip"
            style={{
              position: "absolute",
              bottom: "100%",
              left: `calc(${insetLeft}px + (100% - ${insetLeft}px) * ${activeMarker.xPct / 100})`,
              transform: `translateX(${activeMarker.xPct > 70 ? "-100%" : activeMarker.xPct < 30 ? "0" : "-50%"})`,
              marginBottom: 4,
              maxWidth: 280,
              width: "max-content",
              pointerEvents: "none",
              background: "rgba(12,12,18,0.94)",
              border: `1px solid ${KIND_COLOR[activeMarker.kind]}55`,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              lineHeight: 1.35,
              color: "var(--fg-1)",
              zIndex: 11,
            }}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)", marginBottom: 2 }}>
              {KIND_TEXT[activeMarker.kind]}
            </div>
            {activeMarker.label}
          </div>
        )}
      </div>

      <div
        role="group"
        aria-label="Show event markers"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, paddingLeft: insetLeft }}
      >
        {MARKER_CATEGORIES.map(({ key, label }) => {
          const on = !hidden.has(key);
          const kind: MarkerKind = key === "workouts" ? "workout" : key === "journal" ? "journal" : "drop";
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              data-legend={key}
              onClick={() => toggle(key)}
              className="card-sub"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 4,
                border: `1px solid ${on ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
                background: on ? "rgba(255,255,255,0.05)" : "transparent",
                color: on ? "var(--fg-2)" : "var(--fg-3)",
                textDecoration: on ? "none" : "line-through",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
              }}
            >
              <span style={{ opacity: on ? 1 : 0.4 }}>
                <MarkerShape kind={kind} px={9} />
              </span>
              {key === "workouts" && (
                <span style={{ opacity: on ? 1 : 0.4 }}>
                  <MarkerShape kind="high-strain" px={9} />
                </span>
              )}
              {label}
              <span style={{ color: "var(--fg-3)" }}>
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
