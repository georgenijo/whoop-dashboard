// Browser-side markdown -> sanitized HTML for LLM-generated content.
//
// This is the client counterpart to `sanitize-html.ts`. It must stay free of
// `server-only` and of `jsdom`: it is imported from `"use client"` components,
// so anything it pulls in ships to the browser, and jsdom is several megabytes.
// That is why the coach transcript cannot reuse `sanitizeHtml()`.
//
// `dompurify`'s default export is built once at module load. With no `window`
// present — every server render — the factory bails out early and returns an
// object whose `sanitize` is `undefined` and whose `isSupported` is `false`.
// Calling it there throws `TypeError: <import>.sanitize is not a function`,
// which React swallows into a per-request server error while silently
// downgrading the subtree to client-only rendering (issue #475 section B).
//
// So this function fails *closed*: when no usable sanitizer exists it returns
// `null` and the caller renders escaped plain text through normal React. It
// never returns HTML that has not been through DOMPurify, and it never throws
// on the server.
import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Render markdown to sanitized HTML.
 *
 * Returns `null` when the current environment has no usable DOM sanitizer
 * (i.e. any server render). Callers MUST treat `null` as "render as text" —
 * never as "render the raw markdown as HTML".
 */
export function renderMarkdownToSafeHtml(markdown: string): string | null {
  if (!DOMPurify.isSupported || typeof DOMPurify.sanitize !== "function") {
    return null;
  }
  return DOMPurify.sanitize(marked.parse(markdown) as string);
}
