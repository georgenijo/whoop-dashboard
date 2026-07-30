// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
