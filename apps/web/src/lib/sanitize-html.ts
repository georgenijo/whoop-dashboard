// Server-side HTML sanitization for LLM-generated content (e.g. AIInsightCard).
//
// We deliberately do NOT use `isomorphic-dompurify`: it bundles its own nested
// jsdom@^30 -> undici@8, which calls `webidl.util.markAsUncloneable` — an API
// that only exists on Node >=22.22.2/24.15.0. This repo's CI (and possibly
// prod) runs Node 20, where that throws at import time inside a server
// component's render path. Building directly on the `dompurify` + `jsdom`
// versions already pinned in package.json (jsdom@^29, Node-20-safe) avoids
// the incompatible nested dependency entirely, with no loss of sanitization
// strength.
//
// The JSDOM window and DOMPurify instance are created once at module scope
// and reused across requests — constructing a fresh JSDOM per render would be
// a real performance cost on a hot server-rendered path.
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const purifyWindow = new JSDOM("").window;
const purify = createDOMPurify(purifyWindow as unknown as Window & typeof globalThis);

/** Sanitize LLM/markdown-derived HTML before dangerouslySetInnerHTML. */
export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty);
}
