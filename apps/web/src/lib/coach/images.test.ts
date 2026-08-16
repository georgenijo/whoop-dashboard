// @vitest-environment node
//
// Uses the ambient global `File` (Node 20+ exposes it natively via undici,
// same as in the browser/Next.js request-handling runtime that
// normalizeImageFile() actually runs against) rather than importing `File`
// from node:buffer. The two have incompatible TS types — node:buffer's
// `File` is missing `webkitRelativePath`, which the DOM-lib `File` type
// (what normalizeImageFile()'s signature uses) requires — and the global
// is the one that matches production call sites.
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ChatImageError,
  MAX_IMAGE_EDGE,
  MAX_NORMALIZED_IMAGE_BYTES,
  normalizeImageFile,
  normalizeImageFiles,
} from "./images";

async function imageFile(
  format: "jpeg" | "png" | "webp",
  width = 2400,
  height = 1200,
): Promise<File> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 120, b: 220, alpha: 0.4 },
    },
  });
  const bytes =
    format === "jpeg"
      ? await pipeline.jpeg().toBuffer()
      : format === "png"
        ? await pipeline.png().toBuffer()
        : await pipeline.webp().toBuffer();
  // sharp's .toBuffer() returns a Node Buffer typed Buffer<ArrayBufferLike>
  // (its backing store could in principle be a SharedArrayBuffer), which
  // isn't structurally assignable to BlobPart. Copying into a fresh
  // Uint8Array gives a real ArrayBuffer-backed view that is.
  return new File([new Uint8Array(bytes)], `ignored.${format}`, { type: `image/${format}` });
}

describe("Coach image normalization", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "normalizes %s to a metadata-free bounded JPEG",
    async (format) => {
      const image = await normalizeImageFile(await imageFile(format));
      const metadata = await sharp(image.bytes).metadata();

      expect(image.mimeType).toBe("image/jpeg");
      expect(Math.max(image.width, image.height)).toBe(MAX_IMAGE_EDGE);
      expect(image.bytes.length).toBeLessThanOrEqual(MAX_NORMALIZED_IMAGE_BYTES);
      expect(metadata.format).toBe("jpeg");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    },
  );

  it("applies EXIF orientation before resizing and strips the metadata", async () => {
    const source = await sharp({
      create: {
        width: 40,
        height: 80,
        channels: 3,
        background: "red",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const image = await normalizeImageFile(
      new File([new Uint8Array(source)], "portrait.jpg", { type: "image/jpeg" }),
    );
    const metadata = await sharp(image.bytes).metadata();

    expect(image.width).toBe(80);
    expect(image.height).toBe(40);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects MIME spoofing, corrupt data, SVG, and four images", async () => {
    const jpeg = await imageFile("jpeg", 20, 20);
    const jpegBytes = await jpeg.arrayBuffer();
    await expect(
      normalizeImageFile(
        new File([jpegBytes], "spoof.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ code: "unsupported_image", status: 415 });
    await expect(
      normalizeImageFile(
        new File([Buffer.from([0xff, 0xd8, 0xff, 0x00])], "bad.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_image", status: 422 });
    await expect(
      normalizeImageFile(
        new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toBeInstanceOf(ChatImageError);
    await expect(
      normalizeImageFiles([jpeg, jpeg, jpeg, jpeg]),
    ).rejects.toMatchObject({ code: "too_many_images", status: 413 });
  });

  it("rejects decoded images above 25 megapixels", async () => {
    const hugeHeader = await imageFile("png", 5001, 5000);
    await expect(normalizeImageFile(hugeHeader)).rejects.toMatchObject({
      code: "invalid_image",
      status: 422,
    });
  });
});
