"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EventRow as EventRowData, EventLevel, EventSource } from "@/lib/db/events";
import EventRow from "./EventRow";
import SourceChips from "./SourceChips";
import LevelFilter from "./LevelFilter";
import TimeRangeSelect, { type TimeRange } from "./TimeRangeSelect";
import SearchBox from "./SearchBox";
import LiveTailToggle from "./LiveTailToggle";

const ALL_SOURCES: EventSource[] = [
  "server",
  "web",
  "ios",
  "sync",
  "coach",
  "webhook",
  "route",
];
const DEFAULT_LEVELS: EventLevel[] = ["warn", "error", "fatal"];
const POLL_MS = 3000;

export default function EventTimeline({
  initialEvents,
  customExpand,
}: {
  initialEvents: EventRowData[];
  customExpand?: (event: EventRowData) => ReactNode;
}) {
  const [sources, setSources] = useState<Set<EventSource>>(
    () => new Set(ALL_SOURCES),
  );
  const [levels, setLevels] = useState<Set<EventLevel>>(
    () => new Set<EventLevel>(["info", ...DEFAULT_LEVELS]),
  );
  const [range, setRange] = useState<TimeRange>("24h");
  const [q, setQ] = useState("");
  const [tail, setTail] = useState(false);
  const [events, setEvents] = useState<EventRowData[]>(initialEvents);
  const [loading, setLoading] = useState(false);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (sources.size && sources.size < ALL_SOURCES.length) {
      params.set("sources", Array.from(sources).join(","));
    }
    if (levels.size) params.set("levels", Array.from(levels).join(","));
    params.set("range", range);
    if (q) params.set("q", q);
    return `/api/logs/events?${params.toString()}`;
  }, [sources, levels, range, q]);

  const fetchEvents = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        const res = await fetch(url, { signal, credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { events: EventRowData[] };
        setEvents(body.events);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchEvents(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchEvents]);

  useEffect(() => {
    if (!tail) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return;
      await fetchEvents();
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tail, fetchEvents]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: 12,
          borderRadius: 12,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <SourceChips value={sources} onChange={setSources} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <LevelFilter value={levels} onChange={setLevels} />
          <TimeRangeSelect value={range} onChange={setRange} />
          <LiveTailToggle value={tail} onChange={setTail} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SearchBox value={q} onChange={setQ} />
        <span style={{ color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {loading ? "loading…" : `${events.length} events`}
        </span>
      </div>
      <div
        style={{
          borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        {events.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--fg-3)",
              fontSize: 12,
            }}
          >
            No events match the current filters.
          </div>
        ) : (
          events.map((ev, idx) => (
            <EventRow key={`${ev.ts}-${ev.source}-${idx}`} event={ev} customExpand={customExpand} />
          ))
        )}
      </div>
    </div>
  );
}
