import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import TzBackfill from "./TzBackfill";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const keyFor = (id: number) => `whoop-dashboard:timezone:${id}`;
const fetchMock = vi.fn();

function respond(status: number) {
  fetchMock.mockResolvedValue(new Response(null, { status }));
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TzBackfill", () => {
  it("stores the marker only after a successful (res.ok) write", async () => {
    respond(200);
    render(<TzBackfill userId={7} />);
    await waitFor(() => expect(window.localStorage.getItem(keyFor(7))).toBe(TZ));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 500, 503])("does not store the marker for a %i response, so the next load retries", async (status) => {
    respond(status);
    const first = render(<TzBackfill userId={7} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(keyFor(7))).toBeNull();
    first.unmount();

    render(<TzBackfill userId={7} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not store the marker when the request rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<TzBackfill userId={7} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(keyFor(7))).toBeNull();
  });

  it("skips the request when this account's marker already matches", async () => {
    window.localStorage.setItem(keyFor(7), TZ);
    render(<TzBackfill userId={7} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is per account: one user's marker does not suppress another user's backfill", async () => {
    respond(200);
    window.localStorage.setItem(keyFor(7), TZ);
    render(<TzBackfill userId={8} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem(keyFor(8))).toBe(TZ));
    expect(window.localStorage.getItem(keyFor(7))).toBe(TZ);
    expect(window.localStorage.getItem("whoop-dashboard:timezone")).toBeNull();
  });

  it("still sends the request when localStorage is unavailable", async () => {
    respond(200);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<TzBackfill userId={7} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.restoreAllMocks();
  });
});
