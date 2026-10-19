// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { unavailableMorningBrief } from "@/lib/db/morning-brief";
import {
  MorningWebhookConfigurationError,
  MorningWebhookPublishError,
  publishMorningBrief,
  validateMorningWebhookUrl,
} from "./frame-morning-publisher";

const LOOPBACK_URL = "http://127.0.0.1:8123/api/webhook/private-id";

describe("frame Morning publisher transport", () => {
  it("accepts only literal loopback HTTP Home Assistant webhook URLs", () => {
    expect(validateMorningWebhookUrl(LOOPBACK_URL).hostname).toBe("127.0.0.1");
    expect(validateMorningWebhookUrl("http://[::1]:8123/api/webhook/private-id").hostname).toBe("[::1]");
    for (const value of [
      "http://localhost:8123/api/webhook/private-id",
      "http://192.168.1.2:8123/api/webhook/private-id",
      "https://127.0.0.1:8123/api/webhook/private-id",
      "http://127.0.0.1:8123/api/webhook/private-id?leak=1",
      "http://user:pass@127.0.0.1:8123/api/webhook/private-id",
      "http://127.0.0.1:8123/api/states/sensor.frame_morning_brief",
    ]) {
      expect(() => validateMorningWebhookUrl(value)).toThrow(MorningWebhookConfigurationError);
    }
  });

  it("posts only the brief wrapper with a timeout signal and redirects disabled", async () => {
    const brief = unavailableMorningBrief(new Date("2026-10-18T12:00:00Z"));
    let captured: { input: URL | RequestInfo; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      captured = { input, init };
      return new Response(null, { status: 204 });
    });
    await publishMorningBrief(LOOPBACK_URL, brief, { fetchImpl, timeoutMs: 100 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(captured?.input)).toBe(LOOPBACK_URL);
    expect(captured?.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(captured?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ brief });
  });

  it("rejects HTTP errors, redirects, and network failures without including destination details", async () => {
    for (const fetchImpl of [
      vi.fn(async () => new Response(null, { status: 500 })),
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://example.com" } })),
      vi.fn(async () => { throw new Error(`failed for ${LOOPBACK_URL}`); }),
    ]) {
      const error = await publishMorningBrief(
        LOOPBACK_URL,
        unavailableMorningBrief(),
        { fetchImpl },
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MorningWebhookPublishError);
      expect(String(error)).not.toContain("private-id");
      expect(String(error)).not.toContain("127.0.0.1");
    }
  });

  it("aborts a request that exceeds its timeout", async () => {
    const fetchImpl: typeof fetch = vi.fn((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    await expect(
      publishMorningBrief(LOOPBACK_URL, unavailableMorningBrief(), {
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(MorningWebhookPublishError);
  });
});
