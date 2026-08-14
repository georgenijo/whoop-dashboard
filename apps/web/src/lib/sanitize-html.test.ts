import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { sanitizeHtml } from "./sanitize-html";

// Regression test for the Node-20 CI failure fixed alongside this file:
// `isomorphic-dompurify` bundles a nested jsdom@^30 -> undici@8 that calls
// `webidl.util.markAsUncloneable`, an API missing on Node 20. That failure
// only surfaced through `sanitizeHtml` actually running (module import +
// JSDOM construction), so this test exercises exactly that path rather than
// mocking it away — if the module-scope JSDOM/DOMPurify setup ever regresses
// to something Node-20-incompatible, this test fails without needing a real
// browser DOM, matching how AIInsightCard renders it server-side.
describe("sanitizeHtml", () => {
  it("loads and sanitizes without a browser DOM present", () => {
    expect(sanitizeHtml("<p>hello</p>")).toBe("<p>hello</p>");
  });

  it("strips <script> tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script>hello")).not.toContain("<script");
  });

  it("strips event-handler attributes", () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(1)");
  });

  it("strips javascript: URLs produced by marked from markdown links", () => {
    const html = marked.parse("[x](javascript:alert(1))") as string;
    expect(html).toContain("javascript:alert(1)");
    const out = sanitizeHtml(html);
    expect(out).not.toContain("javascript:");
  });

  it("strips <svg><animate onbegin=...> payloads", () => {
    const out = sanitizeHtml('<svg><animate onbegin="alert(1)" attributeName="x" /></svg>');
    expect(out).not.toContain("onbegin");
    expect(out).not.toContain("alert(1)");
  });

  it("preserves ordinary markdown-derived HTML", () => {
    const html = marked.parse("**bold**\n\n- item\n\n[link](https://example.com)") as string;
    const out = sanitizeHtml(html);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<li>item</li>");
    expect(out).toContain('href="https://example.com"');
  });
});
