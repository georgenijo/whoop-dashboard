import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not part of eslint-config-next's defaults, but needed here: `npm run
    // build` runs `build:mcp` (esbuild) before `next build`, dropping a
    // bundled, gitignored (see /dist/ in .gitignore) build artifact at
    // dist/coach-mcp/server.mjs. Without this, running `npm run lint` after
    // a build lints that generated bundle instead of source and reports
    // spurious no-unused-vars warnings on re-exported/tree-shaken bindings.
    "dist/**",
  ]),
  // Issue #290: forbid raw `req.nextUrl.origin` in API route handlers and
  // the proxy/middleware. Behind nginx + CF Access it leaks the upstream
  // listener (localhost:8501) because Next.js doesn't trust X-Forwarded-*
  // headers. Use `publicOrigin(req)` from @/lib/auth/origin instead. If
  // this is a third-party OAuth callback URI (not a browser-facing
  // redirect target), add `// eslint-disable-next-line no-restricted-syntax`
  // with a one-line reason.
  {
    files: ["src/app/api/**/route.ts", "src/proxy.ts", "src/middleware.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='origin'][object.type='MemberExpression'][object.property.name='nextUrl']",
          message:
            "Don't use `req.nextUrl.origin` in API route handlers — behind Cloudflare Tunnel it can expose the internal listener origin. Use `publicOrigin(req)` from @/lib/auth/origin instead. If this is a third-party callback URI (not a redirect target), add an eslint-disable comment with a reason.",
        },
      ],
    },
  },
  // Issue #475 section B: a "hoist the effect into a memo" refactor (#458)
  // silently deleted the SSR gate around a direct `dompurify` call in
  // `MessageBubble`, because `useEffect` never runs on the server but
  // `useMemo` does — production served the coach transcript ungated for 8
  // days. Ban importing `dompurify` outside the two modules that own
  // sanitization, so that shape of regression fails lint instead of prod.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dompurify",
              message:
                "Don't import dompurify directly. Use `renderMarkdownToSafeHtml` from @/lib/render-markdown in client components, or `sanitizeHtml` from @/lib/sanitize-html in server-only code, instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/render-markdown.ts", "src/lib/sanitize-html.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
