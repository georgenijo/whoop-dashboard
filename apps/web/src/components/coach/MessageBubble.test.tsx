import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import MessageBubble from "./MessageBubble";

// This file runs under vitest's configured `jsdom` environment, so `window`
// exists and `dompurify` initialises normally — it covers the browser half of
// the transcript. The windowless server render (issue #475 section B) is in
// `MessageBubble.ssr.test.tsx`, which must stay a separate file because the
// vitest environment is per-file.
afterEach(cleanup);

const XSS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "[x](javascript:alert(1))",
  '<svg><animate onbegin="alert(1)" attributeName="x" /></svg>',
].join("\n\n");

function browserHtml(content: string): string {
  // A plain client render (not hydration) reads the browser snapshot straight
  // away, which is the same state a streamed assistant message renders in.
  const { container } = render(
    <MessageBubble
      msg={{ role: "assistant", content, streaming: true }}
    />,
  );
  return container.innerHTML;
}

describe("MessageBubble browser render", () => {
  it("renders assistant markdown as HTML once a DOM is available", () => {
    const html = browserHtml(
      "**Recovery is ready.**\n\n- HRV up\n\n[link](https://example.com)",
    );

    expect(html).toContain("<strong>Recovery is ready.</strong>");
    expect(html).toContain("<li>HRV up</li>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("coach-markdown-fallback");
  });

  it("renders a safe Mermaid xychart with a table alternative", () => {
    const content = `**HRV trend**\n\n\`\`\`mermaid
xychart-beta
  title "Morning HRV"
  x-axis ["Aug 15","Aug 16","Aug 17"]
  y-axis "ms" 25 --> 55
  line [38,40,50]
\`\`\``;
    const { container } = render(
      <MessageBubble msg={{ role: "assistant", content, status: "complete" }} />,
    );

    expect(screen.getByRole("region", { name: "Morning HRV" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Morning HRV chart" })).toBeVisible();
    expect(container).not.toHaveTextContent("xychart-beta");

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Morning HRV" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "50 ms" })).toBeVisible();
  });

  it("keeps unsupported Mermaid as sanitized code", () => {
    const html = browserHtml("```mermaid\nflowchart LR\nA --> B\n```");

    expect(html).toContain("language-mermaid");
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("coach-inline-chart");
  });

  it("marks an in-flight answer as streaming without altering its text", () => {
    const { container } = render(
      <MessageBubble
        msg={{ role: "assistant", content: "Recovery is rising", streaming: true }}
      />,
    );

    expect(container.querySelector(".prose-coach.is-streaming")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Coach is writing");
    expect(container).toHaveTextContent("Recovery is rising");
  });

  it("renders completed presentation blocks only on assistant messages", () => {
    const presentationBlocks = [
      {
        version: 1 as const,
        type: "metric_strip" as const,
        fallback: "Recovery is 78 percent.",
        metrics: [
          {
            label: "Recovery",
            value: 78,
            display_value: "78%",
            unit: "%",
            direction: "up" as const,
            tone: "positive" as const,
          },
        ],
      },
    ];
    const assistant = render(
      <MessageBubble
        msg={{
          role: "assistant",
          content: "Recovery is strong.",
          status: "complete",
          presentationBlocks,
        }}
      />,
    );

    expect(screen.getByText("78%")).toBeVisible();
    assistant.unmount();

    render(
      <MessageBubble
        msg={{
          role: "user",
          content: "Show my recovery.",
          status: "complete",
          presentationBlocks,
        }}
      />,
    );
    expect(screen.queryByText("78%")).toBeNull();
  });

  it("strips the standard XSS vectors from streamed assistant content", () => {
    const html = browserHtml(XSS);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onbegin");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<animate");
    expect(html).not.toContain("alert(1)");
  });

  it("never renders user content as HTML", () => {
    const { container } = render(
      <MessageBubble
        msg={{
          role: "user",
          content: '<img src=x onerror="alert(1)">',
          status: "complete",
        }}
      />,
    );

    // The markup survives as escaped text, so the literal "onerror=" characters
    // are present and inert. Assert on the parsed tree instead.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("onerror");
  });

  it("hydrates the server markup without a mismatch, then swaps in markdown", async () => {
    // The whole approach rests on this: the server emits escaped text, the
    // hydration pass must emit exactly that, and only the tick afterwards may
    // swap in sanitized HTML. If the two passes diverged React would throw the
    // tree away and re-render it client-side — the same lost-SSR symptom the
    // crash caused.
    const content = "**Recovery is ready.**";
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <MessageBubble msg={{ role: "assistant", content, status: "complete" }} />,
    );
    document.body.appendChild(container);

    const recoverableErrors: unknown[] = [];
    const root = await act(async () =>
      hydrateRoot(
        container,
        <MessageBubble msg={{ role: "assistant", content, status: "complete" }} />,
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      ),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.innerHTML).toContain("<strong>Recovery is ready.</strong>");

    await act(async () => root.unmount());
    container.remove();
  });

  it("server-renders assistant markdown without requiring a browser DOM", () => {
    // Kept for the hydration contract: the server pass and the hydration pass
    // must produce the same escaped-text markup, or React discards the tree.
    const html = renderToString(
      <MessageBubble
        msg={{
          role: "assistant",
          content: "**Recovery is ready.**",
          status: "complete",
        }}
      />,
    );

    expect(html).toContain("Recovery is ready.");
    expect(html).toContain("coach-markdown-fallback");
  });
});
