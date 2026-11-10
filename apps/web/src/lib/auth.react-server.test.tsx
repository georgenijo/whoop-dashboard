// @vitest-environment node
/**
 * Issue #590 acceptance: "one request performs one user lookup".
 *
 * This runs the REAL `cache()` from React inside a REAL server render. React
 * only memoizes `cache()` under the `react-server` build with a request
 * dispatcher installed, so this file runs in its own vitest project
 * (`react-server`, see vitest.config.ts) and renders through the Flight server
 * renderer that Next bundles — the same renderer App Router uses.
 *
 * What is rendered: the actual `(dashboard)/layout.tsx` wrapping the actual
 * `(dashboard)/page.tsx` (Overview), both calling the real `requireAuthOrSignin`
 * from `@/lib/auth`, backed by a real temp SQLite DB and real signed session
 * JWTs. Only the leaves that are irrelevant to auth are stubbed: client
 * components (chrome, charts, cards — they need a client manifest), next/font,
 * and the insight/API-key modules (network). `getUserById` is wrapped in a spy
 * that delegates to the real implementation.
 */
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// --- per-render context ------------------------------------------------------
// Each render runs inside an AsyncLocalStorage scope so that (1) the mocked
// `headers()` returns that render's headers and (2) spies can attribute every
// call to the render that made it — which lets renders run concurrently.
type RenderCtx = { name: string; headers: Headers };
const renderStore = new AsyncLocalStorage<RenderCtx>();

type Hit = { render: string; userId: number };
const spy = vi.hoisted(() => ({
  getUserById: [] as Array<{ render: string; userId: number }>,
  getUserSettings: [] as Array<{ render: string; userId: number }>,
  routeLogs: [] as Array<{ render: string; userId: number }>,
  after: [] as Array<{ render: string; fn: () => unknown }>,
  currentRender: { fn: (): string => "outside-render" },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    const ctx = renderStore.getStore();
    if (!ctx) throw new Error("headers() called outside a test render");
    return ctx.headers;
  },
}));
// `next/navigation` is a client module outside Next's bundler (it calls
// createContext, absent from the react-server build); only `redirect` is used.
vi.mock("next/navigation", () => ({
  redirect: (destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  },
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    // Remember the render's scope so the callback can later run inside it.
    const ctx = renderStore.getStore();
    spy.after.push({ render: spy.currentRender.fn(), fn: () => renderStore.run(ctx!, fn) });
  },
}));
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "geist-sans" }),
  Geist_Mono: () => ({ variable: "geist-mono" }),
}));

// `getUserById` delegates to the real implementation; everything else in the db
// barrel is real too, except the two observation points below.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getUserById: vi.fn((id: number) => {
      spy.getUserById.push({ render: spy.currentRender.fn(), userId: id });
      return actual.getUserById(id);
    }),
    getUserSettings: vi.fn((id: number) => {
      spy.getUserSettings.push({ render: spy.currentRender.fn(), userId: id });
      return actual.getUserSettings(id);
    }),
    addRouteLog: vi.fn((row: { user_id: number }) => {
      spy.routeLogs.push({ render: spy.currentRender.fn(), userId: row.user_id });
    }),
  };
});

// Leaves unrelated to auth: no network, no client components.
vi.mock("@/lib/coach/api-key", () => ({
  resolveApiKeyForUser: vi.fn(() => {
    throw new Error("no key");
  }),
}));
vi.mock("@/lib/insights", () => ({
  acquireInsightRegenerationLock: vi.fn(() => null),
  getInsightStatus: vi.fn(() => ({
    insight: null,
    isRegenerating: false,
    errorClass: null,
    today: "2026-01-01",
  })),
  regenerateInsight: vi.fn(),
}));
const stub = (name: string) => ({ default: () => <span data-stub={name} /> });
vi.mock("@/components/chrome/Sidebar", () => stub("Sidebar"));
vi.mock("@/components/chrome/TopBar", () => stub("TopBar"));
vi.mock("@/components/chrome/BottomNav", () => stub("BottomNav"));
vi.mock("@/components/ClientLogBootstrap", () => stub("ClientLogBootstrap"));
vi.mock("@/components/WebVitalsReporter", () => stub("WebVitalsReporter"));
vi.mock("@/components/ErrorBoundary", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/overview/RecoveryHero", () => stub("RecoveryHero"));
vi.mock("@/components/overview/KPIStrip", () => stub("KPIStrip"));
vi.mock("@/components/overview/RecoveryTrend", () => stub("RecoveryTrend"));
vi.mock("@/components/overview/AIInsightCard", () => stub("AIInsightCard"));
vi.mock("@/components/overview/PRsCard", () => stub("PRsCard"));
vi.mock("@/components/overview/SetupCard", () => stub("SetupCard"));
vi.mock("@/components/overview/NeedsReconnectBanner", () => stub("NeedsReconnectBanner"));
vi.mock("@/components/onboarding/TzBackfill", () => stub("TzBackfill"));

// --- env + DB -----------------------------------------------------------------
const tmpRoot = mkdtempSync(path.join(tmpdir(), "auth-react-server-test-"));
const dbFile = path.join(tmpRoot, "test.db");
writeFileSync(dbFile, "");
process.env.WHOOP_DB_PATH = dbFile;
process.env.JWT_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");

type FlightServer = {
  renderToPipeableStream: (
    model: unknown,
    webpackMap: Record<string, unknown>,
    opts?: { onError?: (err: unknown) => void },
  ) => { pipe: (w: Writable) => void };
};

let flight: FlightServer;
let RootLayout: (props: { children: ReactNode }) => Promise<ReactNode>;
let OverviewPage: (props: { searchParams: Promise<{ range?: string }> }) => Promise<ReactNode>;
// Async Server Components; the JSX type checker only accepts them from TS 5.1+
// with @types/react 18.2.8+, so keep their JSX usage typed via these aliases.
let signSessionToken: typeof import("@/lib/auth/jwt").signSessionToken;
const userIds: number[] = [];

beforeAll(async () => {
  const { openWrite } = await import("@/lib/db/connection");
  const { markOnboarded } = await import("@/lib/db/user_settings");
  const db = openWrite();
  if (!db) throw new Error("test DB unavailable");
  for (const sub of ["user-a", "user-b"]) {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (apple_sub, email, name) VALUES (?, ?, ?)")
      .run(sub, `${sub}@example.test`, sub);
    userIds.push(Number(lastInsertRowid));
  }
  db.close();
  // Overview redirects to /welcome until onboarded; both users must reach the page body.
  for (const id of userIds) markOnboarded(id);

  ({ signSessionToken } = await import("@/lib/auth/jwt"));
  RootLayout = (await import("@/app/(dashboard)/layout")).default as typeof RootLayout;
  OverviewPage = (await import("@/app/(dashboard)/page")).default as typeof OverviewPage;

  // Load the Flight server through plain Node resolution so it shares the one
  // `react` instance (the `react-server` build) that auth.ts's `cache` came from.
  const require = createRequire(import.meta.url);
  flight = require("next/dist/compiled/react-server-dom-webpack/server.node") as FlightServer;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  spy.getUserById.length = 0;
  spy.getUserSettings.length = 0;
  spy.routeLogs.length = 0;
  spy.after.length = 0;
  spy.currentRender.fn = () => renderStore.getStore()?.name ?? "outside-render";
});

/**
 * One request = one Flight render of the layout wrapping the page, exactly the
 * composition App Router produces for `/`. Resolves with the serialized stream.
 */
async function renderRequest(name: string, headers: Record<string, string>): Promise<string> {
  const ctx: RenderCtx = {
    name,
    headers: new Headers({
      "x-whoop-route-log-route": "/",
      "x-whoop-route-log-started-at": "2026-01-01T00:00:00.000Z",
      "x-whoop-route-log-start-ms": "0",
      ...headers,
    }),
  };
  return renderStore.run(ctx, () => {
    // Elements, not direct calls: Flight must invoke the components itself so
    // that its request-scoped cache dispatcher is installed while they run.
    const tree = (
      <RootLayout>
        <OverviewPage searchParams={Promise.resolve({})} />
      </RootLayout>
    );
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const sink = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(Buffer.from(chunk));
          cb();
        },
        final(cb) {
          resolve(Buffer.concat(chunks).toString("utf8"));
          cb();
        },
      });
      flight.renderToPipeableStream(tree, {}, { onError: reject }).pipe(sink);
    });
  });
}

const cookieFor = async (userId: number) => {
  const { token } = await signSessionToken(userId);
  return { cookie: `__Host-coach_session=${token}` };
};
const lookups = (render: string) => spy.getUserById.filter((h: Hit) => h.render === render);

describe("one request performs one user lookup (real React cache in a real server render)", () => {
  it("is running under the react-server build, where cache() actually memoizes", async () => {
    const React = await import("react");
    let calls = 0;
    const probe = React.cache(() => ++calls);
    // Outside a render there is no cache scope, so this is NOT memoized — it
    // proves the assertions below are measuring a render, not a persistent Map.
    probe();
    probe();
    expect(calls).toBe(2);
    expect(process.execArgv.join(" ")).toContain("--conditions=react-server");
  });

  it("(a) layout + page in one render share exactly one getUserById call", async () => {
    const { userId, headers } = { userId: userIds[0], headers: await cookieFor(userIds[0]) };
    await renderRequest("render-1", headers);

    // Both layout (via requireAuthOrSignin) and page (via requireAuthOrSignin)
    // ran for this user...
    expect(spy.getUserSettings.filter((h) => h.render === "render-1")).toEqual([
      { render: "render-1", userId },
    ]);
    for (const cb of spy.after) await cb.fn();
    expect(spy.routeLogs).toEqual([{ render: "render-1", userId }]);
    // ...but the user was looked up exactly once.
    expect(lookups("render-1")).toEqual([{ render: "render-1", userId }]);
  });

  it("(b) a second render performs a fresh lookup (no leak across requests)", async () => {
    const headers = await cookieFor(userIds[0]);
    await renderRequest("render-1", headers);
    await renderRequest("render-2", headers);
    expect(lookups("render-1")).toHaveLength(1);
    expect(lookups("render-2")).toHaveLength(1);
    expect(spy.getUserById).toHaveLength(2);
  });

  it("(c) two renders for two different users each get their own user, even concurrently", async () => {
    const [a, b] = userIds;
    const [headersA, headersB] = [await cookieFor(a), await cookieFor(b)];
    // B starts one macrotask after A (vitest's per-call dynamic-import mocking of
    // `next/navigation` in auth.ts is unreliable when two imports start in the
    // same tick) but well before A finishes: the Overview page yields to the
    // stream, so the renders genuinely overlap. Asserted below.
    const events: string[] = [];
    const renderA = renderRequest("render-a", headersA).then(() => events.push("done-a"));
    await new Promise((r) => setImmediate(r));
    events.push("start-b");
    const renderB = renderRequest("render-b", headersB).then(() => events.push("done-b"));
    await Promise.all([renderA, renderB]);
    expect(events.indexOf("start-b")).toBeLessThan(events.indexOf("done-a"));
    for (const cb of spy.after) await cb.fn();

    expect(lookups("render-a")).toEqual([{ render: "render-a", userId: a }]);
    expect(lookups("render-b")).toEqual([{ render: "render-b", userId: b }]);
    // The page and the layout in each render saw that render's own user only.
    expect(spy.getUserSettings.filter((h) => h.render === "render-a")).toEqual([
      { render: "render-a", userId: a },
    ]);
    expect(spy.getUserSettings.filter((h) => h.render === "render-b")).toEqual([
      { render: "render-b", userId: b },
    ]);
    expect(spy.routeLogs.filter((h) => h.render === "render-a")).toEqual([
      { render: "render-a", userId: a },
    ]);
    expect(spy.routeLogs.filter((h) => h.render === "render-b")).toEqual([
      { render: "render-b", userId: b },
    ]);
  });
});
