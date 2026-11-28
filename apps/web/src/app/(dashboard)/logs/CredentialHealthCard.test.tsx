// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CredentialHealthCard, { credentialHealthSummary } from "./CredentialHealthCard";
import type { CredentialHealthRow } from "@/lib/db/credential-health";

const row = (over: Partial<CredentialHealthRow> = {}): CredentialHealthRow => ({
  credential: "cursor_shared_key",
  status: "ok",
  last_checked: "2026-11-27T12:30:00.000Z",
  last_ok: "2026-11-27T12:30:00.000Z",
  consecutive_invalid: 0,
  incident_open: false,
  detail: null,
  ...over,
});

describe("CredentialHealthCard", () => {
  it("explains the flag when the probe is off and nothing has been recorded", () => {
    const s = credentialHealthSummary({ row: null, enabled: false, configured: true });
    expect(s.tone).toBe("idle");
    expect(s.note).toContain("COACH_KEY_PROBE=on");
  });

  it("says when no shared key is configured", () => {
    expect(credentialHealthSummary({ row: null, enabled: true, configured: false }).note).toContain(
      "No shared CURSOR_API_KEY",
    );
  });

  it.each(["ok", "invalid", "unreachable"] as const)("renders %s status", (status) => {
    const html = renderToStaticMarkup(
      <CredentialHealthCard row={row({ status })} enabled configured />,
    );
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain("Last checked 2026-11-27 12:30 UTC");
  });

  it("shows the rejection streak and the open-incident wording", () => {
    const html = renderToStaticMarkup(
      <CredentialHealthCard
        row={row({ status: "invalid", consecutive_invalid: 3, incident_open: true, last_ok: null })}
        enabled
        configured
      />,
    );
    expect(html).toContain("3 consecutive rejections");
    expect(html).toContain("Last OK never");
    expect(html).toContain("until it is rotated");
  });
});
