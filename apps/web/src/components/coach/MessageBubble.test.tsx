import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MessageBubble from "./MessageBubble";

describe("MessageBubble", () => {
  it("server-renders assistant markdown without requiring a browser DOM", () => {
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
