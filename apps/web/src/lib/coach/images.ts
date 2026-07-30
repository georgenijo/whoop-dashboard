import "server-only";

import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  type CoachImage,
  MAX_IMAGES_PER_TURN,
} from "./image-types";

export const MAX_RAW_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_RAW_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_NORMALIZED_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 25_000_000;
export const MAX_IMAGE_EDGE = 1600;
export const MAX_MULTIPART_BODY_BYTES = 30 * 1024 * 1024;

export type ChatImageErrorCode =
  | "invalid_request"
  | "unsupported_image"
  | "invalid_image"
  | "too_many_images"
  | "image_too_large"
  | "request_too_large"
  | "attachment_storage_unavailable";

export class ChatImageError extends Error {
  constructor(
    public readonly code: ChatImageErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChatImageError";
  }
}

function sniffMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function jpegAtQuality(input: Buffer, quality: number): Promise<Buffer> {
  return sharp(input, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: false,
  })
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

export async function normalizeImageFile(file: File): Promise<CoachImage> {
  if (file.size <= 0) {
    throw new ChatImageError("invalid_image", 422, "Image is empty.");
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new ChatImageError(
      "image_too_large",
      413,
      "Each image must be 8 MB or smaller.",
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(input);
  const declared = file.type.toLowerCase();
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!sniffed || !allowed.has(declared) || sniffed !== declared) {
    throw new ChatImageError(
      "unsupported_image",
      415,
      "Only valid JPEG, PNG, and WebP images are supported.",
    );
  }

  try {
    const metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_INPUT_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new ChatImageError(
        "invalid_image",
        422,
        "Animated or excessively large images are not supported.",
      );
    }

    let output = await jpegAtQuality(input, 85);
    if (output.length > MAX_NORMALIZED_IMAGE_BYTES) {
      output = await jpegAtQuality(input, 75);
    }
    if (output.length > MAX_NORMALIZED_IMAGE_BYTES) {
      throw new ChatImageError(
        "image_too_large",
        413,
        "Image could not be reduced below the 2 MB storage limit.",
      );
    }
    const normalizedMetadata = await sharp(output).metadata();
    if (!normalizedMetadata.width || !normalizedMetadata.height) {
      throw new ChatImageError("invalid_image", 422, "Image dimensions are unavailable.");
    }
    return {
      id: randomUUID(),
      mimeType: "image/jpeg",
      width: normalizedMetadata.width,
      height: normalizedMetadata.height,
      bytes: output,
      sha256: createHash("sha256").update(output).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ChatImageError) throw error;
    throw new ChatImageError("invalid_image", 422, "Image could not be decoded.");
  }
}

export async function normalizeImageFiles(files: File[]): Promise<CoachImage[]> {
  if (files.length > MAX_IMAGES_PER_TURN) {
    throw new ChatImageError(
      "too_many_images",
      413,
      `Attach no more than ${MAX_IMAGES_PER_TURN} images.`,
    );
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_RAW_IMAGE_BYTES) {
    throw new ChatImageError(
      "request_too_large",
      413,
      "Attached images exceed the 24 MB request limit.",
    );
  }
  const images: CoachImage[] = [];
  for (const file of files) {
    images.push(await normalizeImageFile(file));
  }
  return images;
}
