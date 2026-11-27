import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MessageList from "./MessageList";
import { useChatSend, type ComposerMessage } from "./useChatSend";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const user = (clientId: string, content: string): ComposerMessage => ({
  clientId,
  role: "user",
  content,
});

describe("MessageList keys", () => {
  it("keeps each bubble's DOM node when earlier turns are dropped or inserted", () => {
    const failed: ComposerMessage = {
      clientId: "local:2",
      role: "assistant",
      content: "",
      error: { errorClass: "overloaded", detail: null },
    };
    const { rerender } = render(
      <MessageList
        messages={[user("m:1", "first"), user("local:1", "failed q"), failed, user("m:5", "kept")]}
      />,
    );
    const kept = screen.getByText("kept").closest(".coach-message-row");

    // An index key would hand "kept"'s slot to a different message here.
    rerender(<MessageList messages={[user("m:1", "first"), user("m:5", "kept")]} />);
    expect(screen.getByText("kept").closest(".coach-message-row")).toBe(kept);

    rerender(
      <MessageList messages={[user("m:0", "older"), user("m:1", "first"), user("m:5", "kept")]} />,
    );
    expect(screen.getByText("kept").closest(".coach-message-row")).toBe(kept);
  });

  it("keeps settled bubbles in place while the last one streams", () => {
    const settled = user("m:1", "settled");
    const streaming = (content: string): ComposerMessage => ({
      clientId: "local:9",
      role: "assistant",
      content,
      streaming: true,
    });
    const { rerender } = render(<MessageList messages={[settled, streaming("a")]} />);
    const node = screen.getByText("settled");
    const before = node.textContent;

    rerender(<MessageList messages={[settled, streaming("ab")]} />);

    // Same element, untouched.
    expect(screen.getByText("settled")).toBe(node);
    expect(node.textContent).toBe(before);
  });
});

describe("optimistic ids", () => {
  it("gives persisted rows db ids and optimistic messages unique local ids", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('event: text_delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {"reply":"hi"}\n\n'),
              );
              controller.close();
            },
          }),
        ),
      ),
    );
    const { result } = renderHook(() =>
      useChatSend({
        initialMessages: [
          { id: 7, role: "user", content: "old", created_at: "2026-11-27T00:00:00Z", attachments: [] },
        ],
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      }),
    );
    expect(result.current.messages[0].clientId).toBe("m:7");

    await act(async () => {
      await result.current.send("new");
    });
    const ids = result.current.messages.map((message) => message.clientId);
    expect(ids[0]).toBe("m:7");
    expect(ids[1]).toMatch(/^local:\d+$/);
    expect(ids[2]).toMatch(/^local:\d+$/);
    expect(new Set(ids).size).toBe(3);
    vi.unstubAllGlobals();
  });
});
