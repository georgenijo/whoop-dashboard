import "server-only";
import { getValidAccessToken } from "./token";

const BASE_URL = "https://api.prod.whoop.com/developer";

export class WhoopAuthError extends Error {}
export class WhoopUpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export class WhoopNotFoundError extends Error {}

export async function whoopGet<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let token = await getValidAccessToken();
  if (!token) throw new WhoopAuthError("No valid Whoop token; re-auth required");

  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (resp.status === 401) {
    token = await getValidAccessToken(true);
    if (!token) throw new WhoopAuthError("Refresh failed; re-auth required");
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  }

  if (resp.status === 404) {
    throw new WhoopNotFoundError(`Whoop 404: ${path}`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new WhoopUpstreamError(
      `Whoop ${resp.status}: ${path} ${body.slice(0, 200)}`,
      resp.status,
    );
  }
  return (await resp.json()) as T;
}
