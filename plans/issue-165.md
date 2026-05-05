# Plan: Issue #165 — Atelier Zero: theme flag foundation

**Issues covered:** #165
**Primary file:** `apps/web/src/app/layout.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-165`
**Branch:** `issue/165-atelier-theme-foundation`
**Depends on:** none (must merge first; all #166–#173 depend on this)

## Context

Atelier Zero is a parallel, opt-in editorial redesign. Goal of this foundation: cookie-flag the theme at the layout root so old (Classic dark) and new (Atelier paper) trees can coexist on every page without rewriting old code. Three files are already parked in the repo (`theme-cookie.ts`, `api/theme/route.ts`, `ThemeToggle.tsx`) — they currently do nothing because nothing reads the cookie. This issue wires them in, registers the Atelier fonts, and adds the `:root[data-theme="atelier"]` token block plus a small visibility convention that #166–#173 will rely on.

## Files touched
- `apps/web/src/app/layout.tsx` — read theme cookie, set `data-theme` on `<html>`, register Playfair/Inter Tight fonts.
- `apps/web/src/app/theme.css` — add `:root[data-theme="atelier"]` palette/type tokens and the `.classic-* / .atelier-*` visibility convention.
- `apps/web/src/app/theme-cookie.ts` — already present, **do not edit**.
- `apps/web/src/app/api/theme/route.ts` — already present, **do not edit**.
- `apps/web/src/components/ThemeToggle.tsx` — already present, **do not edit** (consumed by Settings in #173).

## Architectural decisions

- **Decision: cookie-gated theme via `data-theme` attribute on `<html>`, not a CSS class.** Matches the parked `ThemeToggle.tsx` which writes `document.documentElement.dataset.theme`. Selectors stay `:root[data-theme="atelier"] …`.
- **Decision: classic value of the cookie sets the attribute to *undefined* (absent), not `"classic"`.** Mirrors the parked toggle (`delete document.documentElement.dataset.theme`). All Classic CSS continues to live under bare `:root` so old behavior is byte-identical when the cookie is unset.
- **Decision: dual-tree pattern (`<div className="classic-X">` + `<div className="atelier-X">` on every page) gated by CSS, not server-side conditional rendering.** Why: the parked toggle is optimistic and updates `data-theme` synchronously without a server round-trip; CSS gating gives an instant visual swap. Server-side conditional rendering would require a route refresh to flip themes. Trade-off acknowledged: both trees mount on every page (extra DOM, not extra DB queries since data is fetched once and shared). For Coach (#171) where each tree is a heavy stateful client component, both will mount but only one will be visible — acceptable for a single-user dashboard.
- **Decision: Atelier fonts are loaded via `next/font/google` (Playfair Display, Inter Tight) alongside existing Geist/Geist Mono.** Avoids adding @font-face CSS or a new dep. Geist Mono stays as the mono. The mockups also reference "JetBrains Mono"; map that to `--font-geist-mono` to avoid a third font load.
- **Decision: visibility gate is two CSS rules at the root, not a wrapper component.** Keeps the convention discoverable and scoped: any `<div className="atelier-*">` is hidden by default; only shown when `:root[data-theme="atelier"]`. Symmetric rule hides `.classic-*` when atelier is on.

## Implementation steps

1. **`layout.tsx`** — at the top, import cookies and the Atelier fonts:
   ```ts
   import { cookies } from "next/headers";
   import { Geist, Geist_Mono, Playfair_Display, Inter_Tight } from "next/font/google";
   import { getThemeCookie } from "./theme-cookie";
   ```
   Configure `Playfair_Display` (`--font-display-serif`, italic supported) and `Inter_Tight` (`--font-display-sans`) the same way Geist is configured. Keep Geist + Geist Mono.

2. **`layout.tsx`** — inside `RootLayout`, after the existing `headers()` call, read the cookie store and theme:
   ```ts
   const cookieStore = await cookies();
   const theme = getThemeCookie(cookieStore);
   const isAtelier = theme === "atelier";
   ```

3. **`layout.tsx`** — update the `<html>` tag to thread the new font CSS variables and the `data-theme` attribute. Pass `colorScheme: "light"` only when atelier is active:
   ```tsx
   <html
     lang="en"
     className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${interTight.variable}`}
     data-theme={isAtelier ? "atelier" : undefined}
     style={{ colorScheme: isAtelier ? "light" : "dark" }}
   >
   ```
   Do not change the existing chrome (`Sidebar`, `TopBar`, `BottomNav`, `aurora`, `app`/`main`/`content` containers). They keep their existing classes; chrome reskinning is out of scope here.

4. **`theme.css`** — leave the entire existing `:root` block untouched. Append a new `:root[data-theme="atelier"]` block at the bottom of the file with the palette from `whoop-dashboard-atelier.html` (lines 9–25):
   ```css
   :root[data-theme="atelier"] {
     /* paper palette */
     --paper: #efe7d2;
     --paper-warm: #ece4cf;
     --paper-dark: #ddd2b6;
     --bone: #f7f1de;
     --ink: #15140f;
     --ink-soft: #2a2620;
     --ink-mute: #5a5448;
     --ink-faint: #8b8676;
     --coral: #ed6f5c;
     --coral-soft: #f08e7c;
     --mustard: #e9b94a;
     --olive: #6e7448;
     --line: rgba(21,20,15,0.18);
     --line-soft: rgba(21,20,15,0.08);

     /* override base tokens so Classic chrome blends correctly under Atelier */
     --bg-0: var(--paper);
     --bg-1: var(--bone);
     --bg-2: var(--paper-warm);
     --bg-3: var(--paper-dark);
     --fg-0: var(--ink);
     --fg-1: var(--ink-soft);
     --fg-2: var(--ink-mute);
     --fg-3: var(--ink-faint);
     --border-subtle: var(--line-soft);
     --border-default: var(--line);
     --border-strong: var(--line);

     /* Atelier type stack */
     --font-display-serif: var(--font-playfair-display), Georgia, serif;
     --font-display-sans: var(--font-inter-tight), Inter, system-ui, sans-serif;
   }
   ```

5. **`theme.css`** — append the visibility convention immediately after that block. Important: gate **only the page-level wrappers**, not via attribute-prefix selectors (those would also match child classes like `.atelier-kpi-card` and break grid/flex layouts when reverted). Spell out the eight wrapper pairs:
   ```css
   /* Atelier visibility gate — both trees co-exist; CSS swaps them.
      Only the page-level wrappers are gated. Children inside the active
      wrapper inherit visibility naturally and keep their own display rules. */
   .atelier-overview,
   .atelier-recovery,
   .atelier-sleep,
   .atelier-strain,
   .atelier-workouts,
   .atelier-coach,
   .atelier-logs,
   .atelier-settings { display: none; }

   :root[data-theme="atelier"] .classic-overview,
   :root[data-theme="atelier"] .classic-recovery,
   :root[data-theme="atelier"] .classic-sleep,
   :root[data-theme="atelier"] .classic-strain,
   :root[data-theme="atelier"] .classic-workouts,
   :root[data-theme="atelier"] .classic-coach,
   :root[data-theme="atelier"] .classic-logs,
   :root[data-theme="atelier"] .classic-settings { display: none; }

   :root[data-theme="atelier"] .atelier-overview,
   :root[data-theme="atelier"] .atelier-recovery,
   :root[data-theme="atelier"] .atelier-sleep,
   :root[data-theme="atelier"] .atelier-strain,
   :root[data-theme="atelier"] .atelier-workouts,
   :root[data-theme="atelier"] .atelier-coach,
   :root[data-theme="atelier"] .atelier-logs,
   :root[data-theme="atelier"] .atelier-settings { display: block; }
   ```
   Then a base-typography override under `:root[data-theme="atelier"] body`:
   ```css
   :root[data-theme="atelier"] body {
     background: var(--paper);
     color: var(--ink);
     font-family: var(--font-display-sans);
     letter-spacing: -0.005em;
   }
   :root[data-theme="atelier"] .aurora { display: none; } /* paper has no aurora */
   ```

6. **No edits to chrome.** `Sidebar`, `TopBar`, `BottomNav` keep their classes. The token override above means they'll reskin to paper colors automatically; per-issue chrome polish is out of scope and tracked separately.

## Code structure (skeletons)

```tsx
// layout.tsx — relevant additions only
const playfair = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});
```

## Patterns to follow
- Cookie reads use the parked helper (`getThemeCookie(cookieStore)`); do not duplicate the cookie name.
- All new CSS goes in `theme.css`; do not create new global stylesheets.
- No new npm deps. `next/font/google` covers Playfair Display + Inter Tight.
- Do not edit any component under `apps/web/src/components/` in this issue.

## Acceptance criteria (from issue)
- [ ] Default = classic dark UI, zero behavior change (build + dev render visually identical to `main` when no cookie set).
- [ ] `od-theme=atelier` cookie → `<html data-theme="atelier">` and Atelier tokens applied (paper background visible).
- [ ] Toggle persists across reloads (POST `/api/theme` already does this; verify by reload).
- [ ] No old component edited; only additions + layout-level cookie read.

## Verification
- `cd apps/web && npm run build` — clean, no TS errors, no font-load warnings.
- whoop-dev up → open `/` → confirm pixel-identical to current main (no cookie present).
- In devtools, set `document.cookie = "od-theme=atelier; path=/"`, reload → `<html data-theme="atelier">` set, body background flips to `#efe7d2`. Page content in `<div class="atelier-*">` (added by later issues) would now be visible — for this issue it's enough that classic still renders correctly because no atelier wrappers exist yet.
- Toggle from Settings is wired in #173; for #165 verification just hand-set the cookie via `document.cookie = "od-theme=atelier"` or via `curl -X POST localhost:<port>/api/theme -d atelier`.
- agent-browser screenshot of `/` in both states.

## Out of scope (explicit)
- No edits to `Sidebar`/`TopBar`/`BottomNav` or any page under `app/(recovery|sleep|strain|workouts|coach|logs|settings)`. Those are #166–#173.
- No new components.
- No edits to `theme-cookie.ts`, the theme API route, or `ThemeToggle.tsx` — they are already correct as parked.
- No chrome/sidebar redesign — the chrome inherits the paper palette via token overrides only.
- Do not touch `globals.css`.
