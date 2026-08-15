// @vitest-environment node
//
// Issue #475 section B: the coach transcript threw
// `TypeError: <import>.sanitize is not a function` on every server render of a
// thread containing an assistant message, because `dompurify`'s default export
// has no `sanitize` without a `window`.
//
// The `node` environment above is the whole point of this file. The rest of the
// suite runs under vitest's configured `jsdom` environment, where a `window`
// exists at module-eval time and `dompurify` therefore initialises fine — so a
// jsdom-environment test can never reproduce this bug, no matter what it
// asserts. `MessageBubble.test.tsx` covers the browser path; this file is the
// only place that reproduces the production condition.
//
// jsdom is imported below only to *parse* the emitted HTML string for
// assertions. It never touches the component under test, which still renders
// with no global `window` — that is the condition being reproduced.
import { JSDOM } from "jsdom";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdownToSafeHtml } from "@/lib/render-markdown";
import MessageBubble from "./MessageBubble";

const XSS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "[x](javascript:alert(1))",
  '<svg><animate onbegin="alert(1)" attributeName="x" /></svg>',
].join("\n\n");

function ssr(content: string): string {
  return renderToString(
    <MessageBubble
      msg={{ role: "assistant", content, status: "complete" }}
    />,
  );
}

describe("MessageBubble server render (no browser DOM)", () => {
  it("confirms the environment really has no window", () => {
    // Guard against a future config change silently re-enabling jsdom here and
    // turning every assertion below into a no-op.
    expect(typeof window).toBe("undefined");
  });

  it("does not throw on assistant markdown", () => {
    expect(() =>
      ssr("**Recovery is ready.**\n\n- HRV up\n\n[link](https://example.com)"),
    ).not.toThrow();
  });

  it("renders the message as escaped text, not as HTML", () => {
    const html = ssr("**Recovery is ready.**");

    expect(html).toContain("coach-markdown-fallback");
    expect(html).toContain("Recovery is ready.");
    // Markdown deliberately stays unparsed server-side; the browser pass swaps
    // it for sanitized HTML after hydration.
    expect(html).not.toContain("<strong>");
  });

  it("emits no executable markup for the standard XSS vectors", () => {
    const html = ssr(XSS);

    // Assert structurally, not by substring: the payload survives as *text*, so
    // the literal characters "onerror=" are present and harmless. What matters
    // is that parsing the emitted HTML yields no executable node.
    const body = new JSDOM(`<body>${html}</body>`).window.document.body;

    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(body.querySelector("svg")).toBeNull();
    expect(body.querySelector("animate")).toBeNull();
    expect(body.querySelector("a")).toBeNull();
    for (const element of body.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith("on")).toBe(false);
        expect(attribute.value).not.toContain("javascript:");
      }
    }
    // The payload was escaped into text, not silently dropped.
    expect(html).toContain("&lt;script&gt;");
    expect(body.textContent).toContain("alert(1)");
  });

  it("never emits a dangerouslySetInnerHTML container server-side", () => {
    // The sanitized-HTML container carries `prose-coach` without the fallback
    // class; seeing it here would mean unsanitized output reached the server
    // HTML. Assert structurally (parse + inspect the actual element) rather
    // than by substring — a substring check on the exact class attribute
    // string breaks silently if the sanitized container ever grows an extra
    // class, since it would still not equal `class="prose-coach"` verbatim.
    const html = ssr("**bold**");
    const body = new JSDOM(`<body>${html}</body>`).window.document.body;
    const proseCoachElements = body.querySelectorAll(".prose-coach");

    expect(proseCoachElements.length).toBeGreaterThan(0);
    for (const element of proseCoachElements) {
      expect(element.classList.contains("coach-markdown-fallback")).toBe(true);
    }
  });

  it("fails closed at the sanitizer rather than throwing", () => {
    // Defense in depth: even if the component's browser gate is bypassed by a
    // future refactor, the sanitizer must not throw and must not hand back
    // HTML it could not clean.
    expect(renderMarkdownToSafeHtml("**bold** <script>alert(1)</script>")).toBeNull();
  });

  it("survives a user message with markup in it", () => {
    expect(() =>
      renderToString(
        <MessageBubble
          msg={{
            role: "user",
            content: '<script>alert(1)</script>',
            status: "complete",
          }}
        />,
      ),
    ).not.toThrow();
  });
});
