import "server-only";

import { open } from "node:fs/promises";
import {
  parseCoachMcpAuditEvent,
  type CoachMcpAuditEvent,
} from "@/coach-mcp/audit-events";

const AUDIT_POLL_MS = 20;
const AUDIT_FILE_MAX_BYTES = 640_000;

export type CursorMcpAuditListener = {
  drainAndStop: () => Promise<void>;
};

export class CursorMcpAuditChannel {
  constructor(
    readonly path: string,
    readonly runtimeId: string,
  ) {}

  listen(
    turnEpoch: string,
    onEvent: (event: CoachMcpAuditEvent) => void,
    onFailure: (error: Error) => void,
  ): CursorMcpAuditListener {
    let stopped = false;
    let offset = 0;
    let partial = "";
    let pumpTail = Promise.resolve();
    let pumpScheduled = false;
    let failureReported = false;
    const seen = new Set<string>();

    const reportFailure = (error: unknown) => {
      if (failureReported) return;
      failureReported = true;
      onFailure(error instanceof Error ? error : new Error(String(error)));
    };

    const pump = async () => {
      let contents: string;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(this.path, "r");
        const stats = await handle.stat();
        if (stats.size > AUDIT_FILE_MAX_BYTES) {
          reportFailure(
            new Error("Coach MCP audit channel exceeded its size limit"),
          );
          return;
        }
        const bytes = Buffer.alloc(stats.size);
        const { bytesRead } = await handle.read(bytes, 0, stats.size, 0);
        contents = bytes.subarray(0, bytesRead).toString("utf8");
      } catch (error) {
        reportFailure(error);
        return;
      } finally {
        await handle?.close().catch(() => {});
      }
      if (contents.length < offset) {
        reportFailure(new Error("Coach MCP audit channel was replaced mid-turn"));
        offset = 0;
        partial = "";
      }
      const chunk = contents.slice(offset);
      offset = contents.length;
      if (!chunk) return;
      const lines = `${partial}${chunk}`.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const event = parseCoachMcpAuditEvent(line);
        if (!event) {
          reportFailure(
            new Error("Coach MCP audit channel emitted an invalid event"),
          );
          continue;
        }
        if (
          event.runtime_id !== this.runtimeId ||
          event.turn_epoch !== turnEpoch
        ) {
          continue;
        }
        const eventKey = `${event.call_id}:${event.phase}`;
        if (seen.has(eventKey)) continue;
        seen.add(eventKey);
        onEvent(event);
      }
    };

    const schedulePump = () => {
      if (pumpScheduled) return;
      pumpScheduled = true;
      pumpTail = pumpTail
        .then(pump)
        .catch(reportFailure)
        .finally(() => {
          pumpScheduled = false;
        });
    };
    const timer = setInterval(schedulePump, AUDIT_POLL_MS);
    timer.unref?.();
    schedulePump();

    return {
      drainAndStop: async () => {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
        }
        await pumpTail;
        await pump().catch(reportFailure);
        if (partial.trim()) {
          reportFailure(
            new Error("Coach MCP audit channel ended with a partial event"),
          );
        }
      },
    };
  }
}
