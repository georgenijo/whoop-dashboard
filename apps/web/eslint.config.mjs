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
]);

export default eslintConfig;
