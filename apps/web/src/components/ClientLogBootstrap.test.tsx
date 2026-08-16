import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

const warn = vi.fn();

vi.mock("@/lib/clog", () => ({
  clog: {
    info: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: vi.fn(),
    event: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach",
}));

import ClientLogBootstrap from "./ClientLogBootstrap";

/**
 * jsdom has no CSP engine and therefore no SecurityPolicyViolationEvent
 * constructor, so synthesise one with the fields the listener reads. The
 * listener only ever touches plain properties, so this is faithful.
 */
function fireViolation(overrides: Record<string, unknown> = {}) {
  const ev = new Event("securitypolicyviolation");
  Object.assign(ev, {
    disposition: "report",
    effectiveDirective: "img-src",
    violatedDirective: "img-src",
    blockedURI: "https://attacker.example/beacon.png?hrv=78",
    documentURI: "https://coach.test/coach",
    sourceFile: "",
    lineNumber: 0,
    columnNumber: 0,
    sample: "",
    ...overrides,
  });
  document.dispatchEvent(ev);
}

beforeEach(() => {
  warn.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ClientLogBootstrap — CSP violation collector (issue #501)", () => {
  it("forwards a violation through the authenticated client-log pipeline", () => {
    // Deliberately NOT a report-uri collector: that would need an
    // unauthenticated POST endpoint on the public internet. See the comment
    // block in the component.
    render(<ClientLogBootstrap />);
    fireViolation();

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, details] = warn.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("csp-violation");
    expect(details.directive).toBe("img-src");
    expect(details.disposition).toBe("report");
    expect(details.blocked_uri).toBe(
      "https://attacker.example/beacon.png?hrv=78",
    );
  });

  it("dedupes repeats of the same directive + blocked URI", () => {
    // A blocked image inside a re-rendering chart fires this once per paint.
    // Without dedupe, one violation burns the whole per-user rate limit on
    // /api/log/client (10/s) and hides everything else.
    render(<ClientLogBootstrap />);
    for (let i = 0; i < 25; i += 1) fireViolation();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still reports a genuinely different violation", () => {
    render(<ClientLogBootstrap />);
    fireViolation();
    fireViolation({ effectiveDirective: "connect-src" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("caps distinct violations per page load", () => {
    render(<ClientLogBootstrap />);
    for (let i = 0; i < 40; i += 1) {
      fireViolation({ blockedURI: `https://attacker.example/${i}.png` });
    }
    expect(warn).toHaveBeenCalledTimes(20);
  });

  it("truncates a hostile blocked URI instead of logging it whole", () => {
    render(<ClientLogBootstrap />);
    const long = `https://attacker.example/${"a".repeat(4000)}`;
    fireViolation({ blockedURI: long });
    const [, details] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect((details.blocked_uri as string).length).toBeLessThanOrEqual(257);
  });

  it("detaches the listener on unmount", () => {
    const { unmount } = render(<ClientLogBootstrap />);
    unmount();
    fireViolation();
    expect(warn).not.toHaveBeenCalled();
  });
});
