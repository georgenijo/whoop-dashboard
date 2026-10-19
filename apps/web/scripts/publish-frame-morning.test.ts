// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MorningBrief } from "@/lib/db/morning-brief";
import {
  readAccountConfig,
  readWebhookDestination,
  runMorningPublisher,
} from "./publish-frame-morning.mjs";

const WEBHOOK = "http://127.0.0.1:8123/api/webhook/private-id";
const NOW = new Date("2026-10-18T12:00:00Z");

describe("frame Morning publisher CLI", () => {
  it("parses destination separately from the required ID plus exactly one binding", () => {
    expect(readWebhookDestination({ FRAME_MORNING_HA_WEBHOOK_URL: WEBHOOK })).toBe(WEBHOOK);
    expect(readAccountConfig({
      FRAME_MORNING_USER_ID: "2",
      FRAME_MORNING_ACCOUNT_SUBJECT: "stable-subject",
    })).toEqual({
      userId: 2,
      binding: { kind: "account_subject", value: "stable-subject" },
    });
    expect(readAccountConfig({
      FRAME_MORNING_USER_ID: "2",
      FRAME_MORNING_ACCOUNT_SUBJECT: "stable-subject",
      FRAME_MORNING_EMAIL_SHA256: "a".repeat(64),
    })).toBeNull();
  });

  it("publishes unavailable immediately when account configuration is invalid", async () => {
    const published: MorningBrief[] = [];
    const publish = vi.fn(async (_url: string, brief: MorningBrief) => {
      published.push(brief);
    });
    const log = { log: vi.fn(), error: vi.fn() };
    const exitCode = await runMorningPublisher(
      { FRAME_MORNING_HA_WEBHOOK_URL: WEBHOOK, FRAME_MORNING_USER_ID: "2" },
      { publish, now: () => NOW, log },
    );
    expect(exitCode).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(published[0].status).toBe("unavailable");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("private-id");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(JSON.stringify(published[0]));
  });

  it("attempts an unavailable replacement after a healthy HTTP publish failure", async () => {
    const statuses: string[] = [];
    const publish = vi.fn(async (_url: string, brief: MorningBrief) => {
      statuses.push(brief.status);
      if (brief.status !== "unavailable") throw new Error("HTTP 500 with secret details");
    });
    const build = vi.fn(() => ({
      brief: { ...({} as MorningBrief), status: "ok" as const },
      failure: null,
    }));
    const log = { log: vi.fn(), error: vi.fn() };
    const exitCode = await runMorningPublisher(
      {
        FRAME_MORNING_HA_WEBHOOK_URL: WEBHOOK,
        FRAME_MORNING_USER_ID: "2",
        FRAME_MORNING_ACCOUNT_SUBJECT: "stable-subject",
      },
      { publish, build, now: () => NOW, log },
    );
    expect(exitCode).toBe(1);
    expect(statuses).toEqual(["ok", "unavailable"]);
    expect(log.error).toHaveBeenCalledWith("frame morning publish failed");
  });
});
