import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 1 },
    source: "web",
  })),
}));
vi.mock("@/lib/db", () => ({
  getChatAttachmentForUser: vi.fn(),
}));

import { getChatAttachmentForUser } from "@/lib/db";
import { GET } from "./route";

const attachment = {
  id: "10000000-0000-4000-8000-000000000001",
  url: "/api/chat/attachments/10000000-0000-4000-8000-000000000001",
  mime_type: "image/jpeg" as const,
  width: 10,
  height: 20,
  size_bytes: 4,
  bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  sha256: "a".repeat(64),
};

function context(id = attachment.id) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(getChatAttachmentForUser).mockReturnValue(attachment);
});
describe("GET /api/chat/attachments/[id]", () => {
  it("returns authenticated JPEG bytes with private immutable caching", async () => {
    const response = await GET(
      new Request(`http://localhost${attachment.url}`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe(`"${attachment.sha256}"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(attachment.bytes);
    expect(getChatAttachmentForUser).toHaveBeenCalledWith(1, attachment.id);
  });

  it("returns 304 for a matching ETag", async () => {
    const response = await GET(
      new Request(`http://localhost${attachment.url}`, {
        headers: { "if-none-match": `"${attachment.sha256}"` },
      }),
      context(),
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("returns 404 for nonexistent and cross-tenant IDs", async () => {
    vi.mocked(getChatAttachmentForUser).mockReturnValueOnce(null);
    const response = await GET(
      new Request("http://localhost/api/chat/attachments/private"),
      context("private"),
    );
    expect(response.status).toBe(404);
  });
});
