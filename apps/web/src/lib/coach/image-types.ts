import "server-only";

export const MAX_IMAGES_PER_TURN = 3;
export const MAX_ACTIVE_IMAGES = 6;

export type CoachImage = {
  id: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  bytes: Buffer;
  sha256: string;
};

export type CoachUserTurn = {
  displayText: string;
  modelText: string;
  images: CoachImage[];
};

export type CoachConversationMessage = {
  role: "user" | "assistant";
  contentBlocks: unknown[];
  images: CoachImage[];
};

export type ChatAttachmentInsert = CoachImage;

export type ChatAttachment = {
  id: string;
  url: string;
  mime_type: "image/jpeg";
  width: number;
  height: number;
  size_bytes: number;
};
