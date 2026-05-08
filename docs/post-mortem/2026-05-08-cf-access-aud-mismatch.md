# 2026-05-08 — CF Access JWT verification rejected every web request

**Status:** resolved
**Owner:** George
**Affected window:** ~22:11–22:24 UTC (deploy of Phase 3.A → AUD fix landed)
**Surfaces hit:** web `/coach` SSR, every API route under `/api/*` for browser callers
**Severity:** P1 for web (page rendered 500 / empty); P3 for iOS (unaffected — Bearer path)

## Tl;dr

Phase 3.A's CF Access verifier expected the wrong field as the JWT `aud`. Cloudflare puts the **Application Audience Tag** (a 64-char hex hash) in the JWT; we hardcoded the **Access App UUID** (`839d958e-…`). `jose.jwtVerify` rejected every real CF Access JWT with:

```
CF Access verification failed: unexpected "aud" claim value
```

Web requests fell through to the production `requireAuth` 401 path. The `/coach` SSR page was throwing the `Response` object uncaught, so users saw a 500. After we patched the SSR path to use `requireAuth`, it still 401'd because of the underlying AUD mismatch.

## What broke

| Symptom | Where it surfaced |
|---|---|
| Web `/coach` returned 500 ("This page couldn't load. ERROR 2068672604@E394") | Browser, after PR #224 deploy |
| Every web SSR call to `requireAuth` resolved to 401 | Server logs |
| Threads created from web (and from any pre-fix `/coach` visit) landed on `user_id=1` (bootstrap) — invisible after migration | DB |
| iOS path was fine the whole time | iOS uses `Authorization: Bearer …` → SIWA branch, never touches CF Access |

## Timeline (UTC, 2026-05-08)

| Time | Event |
|---|---|
| 21:23 | PR #218 (Phase 3.A) merged. Deployed to VM. Defaults: `CF_ACCESS_AUD = "839d958e-…"` (Access App UUID). |
| 21:24 | First whoop-web boot logs: `[cf-access] CF_ACCESS_AUD unset; defaulting to 839d958e-…` |
| 21:25 | Migration script ran; bootstrap chats moved to `user_id=2`. |
| 21:31–21:40 | iPhone chats arrive, persist on `user_id=2` (correct). Web `/coach` shows empty threads, repeatedly creates ghost untitled threads on `user_id=1`. |
| 21:43 | Discovered `/coach/page.tsx:25` hardcodes `getBootstrapUser()` (PR #224 fixes). Deployed. |
| 22:03 | Post-PR-224, web `/coach` now throws `Error: [object Response]` (500). Stack: SSR uncaught Response from `requireAuth`. |
| 22:11 | Diagnostic deploy: log header keys + `cf-access-jwt-assertion` presence. Confirmed header IS arriving. |
| 22:21 | Deeper diagnostic: log decoded JWT claims. `aud` = `de902ab4…` (hex hash), not the UUID. Verifier rejects with "unexpected 'aud' claim value". |
| 22:23 | PR #226 fixes default AUD to the hex tag; env var also corrected on VM. Deployed. Verified web `/coach` resolves to `user_id=2`. |

## Root cause

Cloudflare Access surfaces two distinct identifiers per app:

| Field | Format | Where it appears | What we used |
|---|---|---|---|
| **Application ID** | UUID (`839d958e-…`) | Admin URL, list of apps API response | ❌ Used as `aud` |
| **Application Audience (AUD) Tag** | 64-char hex (`de902ab4…`) | JWT `aud` claim | ✅ Should have been `aud` |

The CF Access docs use both terms in close proximity and the `apps` list API returns the UUID prominently while the AUD tag appears under a different key. Memory note `cloudflare_setup.md` recorded the App ID; that flowed into the PR #218 default. No one cross-checked against a real JWT until production traffic exercised it.

## How we found it

1. **Visible failure:** web `/coach` 500'd after PR #224 deploy.
2. **First diagnostic:** log incoming header keys. Confirmed `cf-access-jwt-assertion` and `CF_Authorization` cookie both present at origin (so nginx/CF tunnel were fine).
3. **Second diagnostic:** decode the JWT (unverified) inside the SSR page and log `iss`, `aud`, `email`, `alg`. Output:
   ```
   iss=https://georgnijo.cloudflareaccess.com  ✓
   aud=["de902ab4…"]                            ✗ (we expected "839d958e-…")
   email=george.nijo8@gmail.com                 ✓
   alg=RS256                                    ✓
   ```
4. **Verifier error confirms:** `verifyCFAccessJWT` rethrew with `unexpected "aud" claim value`.
5. **Fix:** swap the default + the VM env var to the AUD tag.

## What worked

- **Fast diagnostic loop.** Patching SSR to log + fall back to bootstrap let the page render while we kept iterating instead of every refresh hitting a 500.
- **Decoding the JWT in-place.** Not relying on docs or memory; pulled the truth out of a live token. Should have done this earlier — it's a 10-line change.
- **iOS unaffected.** Two independent auth paths meant iPhone Coach kept working through the entire window.

## What didn't

- **PR #218 review didn't catch the field confusion.** The reviewer had no way to check without a live JWT; nothing in the code base ever told them "this is the App ID, not the AUD." Comment in `cf-access.ts` now flags it.
- **Memory `cloudflare_setup.md` recorded the wrong field name without saying which.** Now needs updating to record both values explicitly.
- **PR #218 had no SSR audit.** `/coach/page.tsx` still used `getBootstrapUser()`. Acceptance criteria covered API routes only; SSR pages were missed. Future auth-touching PRs should grep for `getBootstrapUser` and update *all* callers.
- **`/coach` SSR threw the `Response` object directly.** That works in API routes (Next handles it) but produces a 500 in pages. SSR pages need explicit try/catch + redirect/fallback for `requireAuth` failures.

## Action items

| # | Item | Status |
|---|---|---|
| 1 | Default AUD changed to hex tag (`apps/web/src/lib/auth/cf-access.ts`) | ✅ PR #226 |
| 2 | VM `apps/web/.env.local` set `CF_ACCESS_AUD` explicitly | ✅ |
| 3 | `/coach/page.tsx` uses `requireAuth` not bootstrap | ✅ PR #224 |
| 4 | Update memory `cloudflare_setup.md` to record both Application ID and AUD Tag, with one-line note on which goes where | 📋 todo |
| 5 | Audit other SSR pages for `getBootstrapUser`/hardcoded user_id (one-time grep) | 📋 todo |
| 6 | SSR pages calling `requireAuth` should catch the thrown `Response` and redirect/render appropriately, not let it bubble | 📋 todo (file as issue) |
| 7 | Migration script idempotent — re-run any time stragglers land on `user_id=1` | ✅ already idempotent |

## Prevention

For any future Cloudflare Access changes:

1. **Always decode a real JWT before merging.** Add a one-shot script that pulls a token from a logged-in browser and prints its claims — keep it in `scripts/` so future changes can verify.
2. **Comment fields whose names are ambiguous.** "Use the AUD tag here, NOT the Access app UUID" beats trusting a memory note.
3. **PRs that change `requireAuth` must list every caller.** SSR + API + middleware. Grep is fine; the point is the audit happens.
4. **SSR pages that throw `Response` need a wrapper.** Either a shared helper or per-page try/catch — don't surface a 500 to the user when a redirect is the right answer.
