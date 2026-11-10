// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ forModule: () => ({ warn }) }));

import {
  buildAnthropicConversation,
  flattenCursorConversation,
  selectActiveImageContext,
} from "./conversation";
import type {
  CoachConversationMessage,
  CoachImage,
  CoachUserTurn,
} from "./image-types";

function image(id: string): CoachImage {
  return {
    id,
    mimeType: "image/jpeg",
    width: 10,
    height: 10,
    bytes: Buffer.from(`jpeg-${id}`),
    sha256: id.padEnd(64, "0").slice(0, 64),
  };
}

function userMessage(index: number): CoachConversationMessage {
  return {
    role: "user",
    contentBlocks: [{ type: "text", text: `message ${index}` }],
    images: [image(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)],
  };
}

describe("Anthropic tool pairing", () => {
  const turn: CoachUserTurn = {
    displayText: "Follow up",
    modelText: "Follow up",
    images: [],
  };
  const followUp = { role: "user", content: [{ type: "text", text: "Follow up" }] };
  const text = (value: string) => ({ type: "text", text: value });
  const use = (id: string) => ({ type: "tool_use", id, name: "query_recovery", input: {} });
  const result = (id: string) => ({ type: "tool_result", tool_use_id: id, content: "[]" });
  const message = (
    role: "user" | "assistant",
    ...contentBlocks: unknown[]
  ): CoachConversationMessage => ({ role, contentBlocks, images: [] });

  beforeEach(() => warn.mockClear());

  it("keeps valid parallel calls and consecutive tool rounds without warning or mutation", () => {
    const history = [
      message("user", text("Recovery?")),
      message("assistant", text("Checking"), use("a"), use("b")),
      message("user", result("b"), result("a")),
      message("assistant", use("c")),
      message("user", result("c")),
      message("assistant", text("Done")),
    ];
    const before = structuredClone(history);

    expect(buildAnthropicConversation(history, turn)).toEqual([
      ...history.map(({ role, contentBlocks }) => ({ role, content: contentBlocks })),
      followUp,
    ]);
    expect(history).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["leading", "interior"])("drops an %s orphaned tool_result and its empty row", (position) => {
    const history = [
      ...(position === "interior" ? [message("user", text("Recovery?"))] : []),
      message("user", result("missing")),
      message("assistant", text("Previous answer")),
    ];

    expect(buildAnthropicConversation(history, turn)).toEqual([
      ...(position === "interior"
        ? [{ role: "user", content: [text("Recovery?")] }]
        : []),
      { role: "assistant", content: [text("Previous answer")] },
      followUp,
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { dropped_tool_uses: 0, dropped_tool_results: 1 },
      expect.any(String),
    );
  });

  it("drops an orphaned tool_use before the current turn and preserves its narration", () => {
    expect(buildAnthropicConversation([
      message("assistant", text("Checking recovery"), use("missing")),
    ], turn)).toEqual([
      { role: "assistant", content: [text("Checking recovery")] },
      followUp,
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { dropped_tool_uses: 1, dropped_tool_results: 0 },
      expect.any(String),
    );
  });

  it("drops both sides of mismatched IDs without leaving empty messages", () => {
    expect(buildAnthropicConversation([
      message("assistant", use("a")),
      message("user", result("b")),
    ], turn)).toEqual([followUp]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { dropped_tool_uses: 1, dropped_tool_results: 1 },
      expect.any(String),
    );
  });

  it("preserves valid siblings in a partially broken parallel tool round", () => {
    expect(buildAnthropicConversation([
      message("assistant", use("a"), use("missing-result")),
      message("user", result("a"), result("missing-use"), text("Keep this")),
    ], turn)).toEqual([
      { role: "assistant", content: [use("a")] },
      { role: "user", content: [result("a"), text("Keep this")] },
      followUp,
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { dropped_tool_uses: 1, dropped_tool_results: 1 },
      expect.any(String),
    );
  });

  it("does not pair across an intervening message even if that message is empty", () => {
    expect(buildAnthropicConversation([
      message("assistant", use("a")),
      message("assistant"),
      message("user", result("a")),
    ], turn)).toEqual([followUp]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { dropped_tool_uses: 1, dropped_tool_results: 1 },
      expect.any(String),
    );
  });

  it("rejects tool blocks in the wrong roles", () => {
    expect(buildAnthropicConversation([
      message("user", use("a")),
      message("assistant", result("a")),
    ], turn)).toEqual([followUp]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(["tool_use", "tool_result"])("drops both sides when %s IDs are duplicated", (type) => {
    expect(buildAnthropicConversation([
      message("assistant", use("a"), ...(type === "tool_use" ? [use("a")] : [])),
      message("user", result("a"), ...(type === "tool_result" ? [result("a")] : [])),
    ], turn)).toEqual([followUp]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("preserves attached images and user text when stripping an orphaned result", () => {
    const user = message("user", result("missing"), text("Keep my caption"));
    user.images = [image("attached")];
    const history = [user];

    const messages = buildAnthropicConversation(history, turn);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: user.images[0].bytes.toString("base64") },
          },
          text("Keep my caption"),
        ],
      },
      followUp,
    ]);
    expect(user.contentBlocks).toEqual([result("missing"), text("Keep my caption")]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("provider-neutral image context", () => {
  it("always includes current images and fills to six from newest history", () => {
    const history = Array.from({ length: 7 }, (_, index) => userMessage(index + 1));
    const turn: CoachUserTurn = {
      displayText: "current",
      modelText: "current",
      images: [image("10000000-0000-4000-8000-000000000001")],
    };
    const selected = selectActiveImageContext(history, turn);

    expect(selected.images).toHaveLength(6);
    expect(selected.activeIds.has(history[6].images[0].id)).toBe(true);
    expect(selected.activeIds.has(history[2].images[0].id)).toBe(true);
    expect(selected.activeIds.has(history[1].images[0].id)).toBe(false);
  });

  it("orders Anthropic image blocks before the user text block", () => {
    const turn: CoachUserTurn = {
      displayText: "read this",
      modelText: "read this",
      images: [image("10000000-0000-4000-8000-000000000001")],
    };
    const messages = buildAnthropicConversation([], turn);
    const content = messages[0].content as Array<{ type: string }>;

    expect(content.map((block) => block.type)).toEqual(["image", "text"]);
    expect(JSON.stringify(content)).toContain(
      turn.images[0].bytes.toString("base64"),
    );
  });

  it("uses the same active IDs and omission marker in Cursor history", () => {
    const history = Array.from({ length: 7 }, (_, index) => userMessage(index + 1));
    const turn: CoachUserTurn = {
      displayText: "",
      modelText: "Analyze the attached image.",
      images: [],
    };
    const context = selectActiveImageContext(history, turn);
    const transcript = flattenCursorConversation(history, context.activeIds);

    expect(context.images).toHaveLength(6);
    expect(transcript).toContain("outside the active image context");
    expect(transcript).toContain("call view_chat_image");
  });
});
