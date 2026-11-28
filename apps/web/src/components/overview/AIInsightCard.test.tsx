import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AIInsightCard from "./AIInsightCard";

describe("AIInsightCard", () => {
  it("labels today using the same user-local day as generation", () => {
    const html = renderToString(<AIInsightCard hasData refreshing={false} today="2026-11-09"
      insight={{ date: "2026-11-09", insight: "Local-day advice", created_at: null }} />);
    expect(html).toContain("Today");
  });

  it.each(["no_key", "bad_key", "provider_error"] as const)("shows %s failures alongside a cached insight", (errorClass) => {
    const html = renderToString(<AIInsightCard hasData refreshing={false} errorClass={errorClass}
      insight={{ date: "2026-11-09", insight: "Cached advice", created_at: null }} />);
    expect(html).toContain("Insight unavailable");
    expect(html).toContain(errorClass.replaceAll("_", " "));
    expect(html).toContain("Cached advice");
  });

  it("strips script tags and event-handler attributes from LLM-generated insight markdown", () => {
    const html = renderToString(
      <AIInsightCard
        hasData
        refreshing={false}
        insight={{
          date: "2026-08-12",
          created_at: null,
          insight:
            '<script>alert(1)</script><img src=x onerror="alert(1)"> Recovery looks good.',
        }}
      />,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("Recovery looks good.");
  });

  it("still renders ordinary markdown (bold, links, lists) untouched", () => {
    const html = renderToString(
      <AIInsightCard
        hasData
        refreshing={false}
        insight={{
          date: "2026-08-12",
          created_at: null,
          insight:
            "**Great sleep** last night.\n\n- HRV up\n- RHR down\n\nSee [more](https://example.com).",
        }}
      />,
    );

    expect(html).toContain("<strong>Great sleep</strong>");
    expect(html).toContain("<li>HRV up</li>");
    expect(html).toContain('href="https://example.com"');
  });
});
