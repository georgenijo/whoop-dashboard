import "server-only";

import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import {
  type CoachConversationMessage,
  type CoachImage,
  type CoachUserTurn,
  MAX_ACTIVE_IMAGES,
} from "./image-types";

export const OMITTED_IMAGE_MARKER =
  "[An earlier attached image is outside the active image context. Ask the user to reattach it before making a fresh visual analysis.]";

function textBlock(text: string): ContentBlockParam {
  return { type: "text", text };
}
function imageBlock(image: CoachImage): ContentBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mimeType,
      data: image.bytes.toString("base64"),
    },
  };
}

function normalizedBlocks(blocks: unknown[]): ContentBlockParam[] {
  return blocks.filter(
    (block): block is ContentBlockParam =>
      typeof block === "object" && block !== null && "type" in block,
  );
}

export type ActiveImageContext = {
  images: CoachImage[];
  activeIds: ReadonlySet<string>;
};

export function selectActiveImageContext(
  conversation: CoachConversationMessage[],
  turn: CoachUserTurn,
): ActiveImageContext {
  const activeIds = new Set(turn.images.map((image) => image.id));
  const prior: CoachImage[] = [];
  let remaining = Math.max(0, MAX_ACTIVE_IMAGES - turn.images.length);

  for (let index = conversation.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const images = conversation[index].images;
    for (let imageIndex = images.length - 1; imageIndex >= 0 && remaining > 0; imageIndex -= 1) {
      const image = images[imageIndex];
      if (activeIds.has(image.id)) continue;
      activeIds.add(image.id);
      prior.push(image);
      remaining -= 1;
    }
  }

  return {
    images: [...turn.images, ...prior.reverse()],
    activeIds,
  };
}

function messageBlocks(
  message: CoachConversationMessage,
  activeIds: ReadonlySet<string>,
): ContentBlockParam[] {
  const stored = normalizedBlocks(message.contentBlocks);
  if (message.role !== "user" || message.images.length === 0) return stored;

  const active = message.images.filter((image) => activeIds.has(image.id));
  const omittedCount = message.images.length - active.length;
  return [
    ...active.map(imageBlock),
    ...stored,
    ...(omittedCount > 0 ? [textBlock(OMITTED_IMAGE_MARKER)] : []),
  ];
}

export function buildAnthropicConversation(
  conversation: CoachConversationMessage[],
  turn: CoachUserTurn,
): MessageParam[] {
  const { activeIds } = selectActiveImageContext(conversation, turn);
  const messages: MessageParam[] = conversation.map((message) => ({
    role: message.role,
    content: messageBlocks(message, activeIds),
  }));
  messages.push({
    role: "user",
    content: [
      ...turn.images.map(imageBlock),
      textBlock(turn.modelText),
    ],
  });
  return messages;
}

function blockText(blocks: unknown[]): string {
  return blocks
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("")
    .trim();
}

export function flattenCursorConversation(
  conversation: CoachConversationMessage[],
  activeIds: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  for (const message of conversation) {
    const text = blockText(message.contentBlocks);
    const label = message.role === "user" ? "User" : "Assistant";
    const imageMarkers =
      message.role === "user"
        ? message.images.map((image) =>
            activeIds.has(image.id)
              ? `[Attached image ${image.id}; call view_chat_image with this attachment_id before analyzing it.]`
              : OMITTED_IMAGE_MARKER,
          )
        : [];
    const content = [...imageMarkers, text].filter(Boolean).join("\n");
    if (content) lines.push(`${label}: ${content}`);
  }
  return lines.join("\n");
}
