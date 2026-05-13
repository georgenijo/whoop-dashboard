import "server-only";

/**
 * Display-safe rendering of an Anthropic API key. Never returns cleartext —
 * the UI only ever sees `sk-ant-…XXXX` where XXXX is the trailing four
 * characters. Used by the BYOK GET/POST responses and any future audit log.
 */
export function maskAnthropicKey(key: string): string {
  const tail = key.slice(-4);
  return `sk-ant-…${tail}`;
}
