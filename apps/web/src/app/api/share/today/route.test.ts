// @vitest-environment node
//
// GET /api/share/today renders a real PNG through next/og (Satori + Resvg).
// `fetch` is replaced for the whole file with a stub that only serves
// `data:` URLs (next/og loads its bundled Yoga/Resvg wasm that way, in
// process) and throws on anything else, so a passing render also proves the
// image needs no network: no Google Fonts fallback, no emoji CDN.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTodayCard } from "@/lib/share/todayCard";
import { fullDay, input } from "@/lib/share/__fixtures__/shareRows";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  requireAuth: vi.fn<(req: Request) => Promise<{ user: { id: number }; source: "web" }>>(async () => ({
    user: { id: 7 },
    source: "web",
  })),
  loadTodayCard: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: m.requireAuth }));
vi.mock("@/lib/share/load", () => ({ loadTodayCard: m.loadTodayCard }));

import { GET } from "./route";

const realFetch = globalThis.fetch;
const networkCalls: string[] = [];
const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("data:")) return realFetch(input, init);
  networkCalls.push(url);
  throw new Error(`network access is not allowed in the share-card image route: ${url}`);
});
beforeAll(() => {
  globalThis.fetch = fetchStub as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const req = (q = "") => new Request(`http://localhost/api/share/today${q}`);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

beforeEach(() => {
  vi.clearAllMocks();
  m.loadTodayCard.mockImplementation((_u: number, opts: { hideNumbers: boolean; theme: "dark" | "light" }) =>
    buildTodayCard(fullDay("2026-11-27", opts)),
  );
});
afterEach(() => {
  delete process.env.SHARE_CARD;
});

async function expectPng(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(bytes.length).toBeGreaterThan(1000);
  expect([...bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
  // IHDR width/height (big-endian at bytes 16..23): 1080 x 1350.
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([1080, 1350]);
  return bytes;
}

describe("GET /api/share/today — flag off", () => {
  it.each([undefined, "0", "true"])("SHARE_CARD=%j → 404 before auth or any DB read", async (v) => {
    if (v !== undefined) process.env.SHARE_CARD = v;
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(m.requireAuth).not.toHaveBeenCalled();
    expect(m.loadTodayCard).not.toHaveBeenCalled();
  });
});

describe("GET /api/share/today — flag on", () => {
  beforeEach(() => {
    process.env.SHARE_CARD = "1";
  });

  it("no session → 401 from requireAuth, no data read", async () => {
    m.requireAuth.mockImplementationOnce(async () => {
      throw Response.json({ error: "unauthorized" }, { status: 401 });
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(m.loadTodayCard).not.toHaveBeenCalled();
  });

  it("returns a private, downloadable PNG of the signed-in user's card", async () => {
    const res = await GET(req());
    await expectPng(res);
    expect(m.loadTodayCard).toHaveBeenCalledWith(7, { hideNumbers: false, theme: "dark" });
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="coach-day-2026-11-27.png"');
    expect(networkCalls).toEqual([]);
  });

  it("hide-numbers + light theme render too, and differ from the default image", async () => {
    const plain = await expectPng(await GET(req()));
    const res = await GET(req("?hide=1&theme=light"));
    const hidden = await expectPng(res);
    expect(m.loadTodayCard).toHaveBeenLastCalledWith(7, { hideNumbers: true, theme: "light" });
    expect(Buffer.from(hidden).equals(Buffer.from(plain))).toBe(false);
    expect(networkCalls).toEqual([]);
  });

  it("an empty day still renders", async () => {
    m.loadTodayCard.mockImplementationOnce(() => buildTodayCard(input()));
    await expectPng(await GET(req()));
  });
});
