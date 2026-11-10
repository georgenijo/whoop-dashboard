"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GenerationErrorClass } from "@/lib/db/ai-generation";

const POLL_WINDOW_MS = 5 * 60_000;
const REASONS = { no_key: "no key", bad_key: "bad key", provider_error: "provider error" };

type Status = {
  ready: boolean;
  isRegenerating: boolean;
  errorClass: GenerationErrorClass | null;
};

export default function AIInsightRefreshWatcher({
  active = true,
  errorClass = null,
}: {
  active?: boolean;
  errorClass?: GenerationErrorClass | null;
}) {
  const { refresh } = useRouter();
  const [pollError, setPollError] = useState<GenerationErrorClass | null>(null);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let delay = 2_000;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + POLL_WINDOW_MS;
    const controller = new AbortController();

    const schedule = () => {
      timer = setTimeout(() => void poll(), delay);
      delay = Math.min(delay * 2, 30_000);
    };
    const poll = async () => {
      if (stopped) return;
      if (Date.now() >= deadline) {
        setPollError("provider_error");
        return;
      }
      try {
        const response = await fetch("/api/insights/status", {
          cache: "no-store", signal: controller.signal,
        });
        if (stopped) return;
        if (!response.ok) {
          if (response.status === 401) {
            setPollError("provider_error");
            return;
          }
          throw new Error("Status unavailable");
        }
        const status = await response.json() as Status;
        if (stopped) return;
        if (status.ready) {
          // Exactly one page refresh after successful completion.
          refresh();
          return;
        }
        if (!status.isRegenerating) {
          setPollError(status.errorClass ?? "provider_error");
          return;
        }
      } catch {
        if (stopped) return;
      }
      schedule();
    };
    schedule();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, refresh]);

  const failure = pollError ?? errorClass;
  return active && !pollError ? (
    <span className="ai-refreshing" role="status">Refreshing...</span>
  ) : failure ? (
    <span role="status">Insight unavailable ({REASONS[failure]}). Check Settings.</span>
  ) : null;
}
