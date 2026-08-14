import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AIInsightCard from "./AIInsightCard";

describe("AIInsightCard", () => {
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
