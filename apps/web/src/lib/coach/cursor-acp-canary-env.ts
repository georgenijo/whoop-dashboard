/**
 * Environment for the authenticated Cursor ACP canary child
 * (`scripts/check-cursor-acp-user.ts` → `scripts/check-cursor-acp.mjs`).
 *
 * Allowlist, not denylist: the canary runs with a real user's Cursor key on
 * the production host, so the app's own secrets (session signing, vault, AI
 * provider keys, OAuth client secrets) must never reach it.
 */
export const CURSOR_ACP_CANARY_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "CURSOR_BACKEND_URL",
] as const;

export function cursorAcpCanaryChildEnv(
  source: NodeJS.ProcessEnv,
  cursorApiKey: string,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    CURSOR_API_KEY: cursorApiKey,
    NODE_ENV: source.NODE_ENV,
  };
  for (const name of CURSOR_ACP_CANARY_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) childEnv[name] = value;
  }
  return childEnv;
}
