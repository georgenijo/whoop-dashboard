import "server-only";

/** Cursor launches MCP servers with an explicit environment, not the app's
 * inherited env. Supply only what the tenant-scoped Whoop client needs to
 * decrypt its vault row and refresh OAuth. Never log this object or put it
 * into model prompts/tool responses. No session-signing or AI-provider keys. */
export function whoopMcpEnv(): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const name of ["VAULT_KEY", "WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET"] as const) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}
