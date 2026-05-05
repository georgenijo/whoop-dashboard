# Plan: Issue #173 — Atelier Zero: settings page (theme toggle as star)

**Issues covered:** #173
**Primary file:** `apps/web/src/app/settings/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-173`
**Branch:** `issue/173-atelier-settings`
**Depends on:** #165

## Context

Settings is where the parked `ThemeToggle.tsx` finally gets its public home. Classic settings page (already a `"use client"` component) stays untouched. Atelier version is a multi-section editorial layout: I. Visual Theme (with α/β preview cards and the prominent toggle), II. Data & Sync (read-only sync info), III. Coach (system prompt + use-API toggle, mirrors classic), IV. Notifications (placeholder — feature not yet built), V. Account (placeholder). Headline: *"Settings, calibrated by hand."*

## Files touched
- `apps/web/src/app/settings/page.tsx` — convert to a server wrapper that renders both `<ClassicSettings>` (current implementation, extracted to a sibling client component) and `<AtelierSettings>`.
- `apps/web/src/app/settings/ClassicSettings.tsx` *(new)* — client component holding the current settings UI verbatim. Extracted so the page module can be a server component that conditionally renders both trees.
- `apps/web/src/app/settings/AtelierSettings.tsx` *(new, `"use client"`)* — Atelier shell with the 5 sections.
- `apps/web/src/components/settings/atelier/ThemeStage.tsx` *(new)* — α / β preview cards + the prominent toggle (wraps `ThemeToggle.tsx` parked component).
- `apps/web/src/components/settings/atelier/SyncSection.tsx` *(new)* — sync status card.
- `apps/web/src/components/settings/atelier/CoachSection.tsx` *(new)* — system prompt textarea + use-API toggle (mirrors classic logic).
- `apps/web/src/app/theme.css` — append `.atelier-settings *` selectors.

## Architectural decisions

- **Decision: extract current settings UI to `ClassicSettings.tsx` *unchanged* and convert `settings/page.tsx` to a thin server wrapper.** Why: the current page is one big `"use client"` component returning the whole tree; to render BOTH trees we need a server boundary. The simplest, safest move is to lift the current code verbatim into `ClassicSettings.tsx` and import it. This keeps the dual-tree convention intact and doesn't touch existing classic behavior. (Alternative: make the page itself client-side and render both shells — works, but mixes concerns; the wrapper-approach is cleaner.)
- **Decision: `ThemeStage` wraps the parked `ThemeToggle.tsx`** as the actual switch. Add visual α / β preview cards alongside it but the *interactive control* is the parked toggle (not a re-implementation). Keeps a single source of truth for theme writing.
- **Decision: Settings hits `/api/settings` for `system_prompt` + `use_api_mode`.** Reuses classic's effects/handlers — duplicate the same `useEffect` + `fetch` calls in `CoachSection`. Acceptable duplication since both trees can be open and we want them to behave independently when one is interacting.
- **Decision: Notifications + Account sections render as placeholder cards** with copy "Coming soon" — mockup includes them but no backend exists. Document as out-of-scope features. Keep the section headers for layout fidelity.
- **Decision: sync section is read-only in Atelier.** Show last sync time and a "Sync now" button that POSTs `/api/sync` (already exists). No new API.
- **Decision: theme cookie is read server-side in the wrapper** to set the *initial* visual state of the α/β preview cards (which one is "current"). This gives the right server-rendered HTML; the toggle then handles the optimistic flip.

## Implementation steps

1. **Extract classic** — copy the entire current `settings/page.tsx` content into `apps/web/src/app/settings/ClassicSettings.tsx`. Rename the export to `ClassicSettings`. Keep `"use client"`. Do not change any logic.

2. **Rewrite `settings/page.tsx`** as a server component:
   ```tsx
   import { cookies } from "next/headers";
   import { getThemeCookie } from "@/app/theme-cookie";
   import ClassicSettings from "./ClassicSettings";
   import AtelierSettings from "./AtelierSettings";

   export const dynamic = "force-dynamic";

   export default async function SettingsPage() {
     const cookieStore = await cookies();
     const theme = getThemeCookie(cookieStore);
     return (
       <>
         <div className="classic-settings"><ClassicSettings /></div>
         <div className="atelier-settings"><AtelierSettings initialTheme={theme} /></div>
       </>
     );
   }
   ```

3. **`AtelierSettings.tsx`** *(new, `"use client"`)* — top-level shell. Five sections (I…V) with sec-rules. Renders:
   ```tsx
   <h1 className="atelier-settings-title">
     Settings, <em>calibrated by hand</em>.
   </h1>
   <ThemeStage initialTheme={initialTheme} />
   <SyncSection />
   <CoachSection />
   <PlaceholderSection roman="IV." title="Notifications" copy="Push channels — coming soon." />
   <PlaceholderSection roman="V." title="Account" copy="Multi-user is on the roadmap." />
   ```

4. **`ThemeStage.tsx`** *(new)* — props: `initialTheme: Theme`. Renders the sec-rule (Roman I., headline "Pick a *surface*. Coach reads either."), the two α/β preview cards (paper-tone block with swatches + mini "72" preview per mockup lines 1196–1280), and embeds the parked `<ThemeToggle />` as the control. The "is-active" highlight on the α / β cards reflects local state synced from the toggle (read `document.documentElement.dataset.theme` in a `useEffect` after toggle).

5. **`SyncSection.tsx`** *(new, `"use client"`)* — fetches `/api/sync/status` (if exists) or just shows a "Sync now" button calling `POST /api/sync`. Mockup line 1283.

6. **`CoachSection.tsx`** *(new, `"use client"`)* — same effects as `ClassicSettings`: load `/api/settings`, render system prompt textarea + Reset/Save buttons + use-API toggle. Atelier-styled wrapper.

7. **`PlaceholderSection`** — small inline subcomponent (defined in `AtelierSettings.tsx`) that renders sec-rule + headline + a hairline-bordered "—" card.

8. **`theme.css`** — append `.atelier-settings`, `.atelier-sec-rule`, `.atelier-theme-stage`, `.atelier-theme-card` (`.classic` / `.zero` variants), `.atelier-swatch-row`, `.atelier-theme-switch` wrapper, `.atelier-coach-prompt-area`, `.atelier-placeholder-card`. Mockup `mockup-settings.html` lines 1–1130 contains the full token block. Scope under `:root[data-theme="atelier"]`.

## Code structure (skeletons)

```tsx
// AtelierSettings.tsx
type Props = { initialTheme: "classic" | "atelier" };
export default function AtelierSettings({ initialTheme }: Props) {
  return (
    <div className="atelier-settings-shell">
      <ThemeStage initialTheme={initialTheme} />
      {/* …other sections… */}
    </div>
  );
}
```

```tsx
// ThemeStage.tsx — toggle integration
import ThemeToggle from "@/components/ThemeToggle";

const [active, setActive] = useState<Theme>(initialTheme);
useEffect(() => {
  const obs = new MutationObserver(() => {
    const next = document.documentElement.dataset.theme === "atelier" ? "atelier" : "classic";
    setActive(next);
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}, []);

return (
  <section className="atelier-theme-stage">
    <ThemeCard variant="classic" active={active === "classic"} />
    <ThemeCard variant="zero" active={active === "atelier"} />
    <div className="atelier-theme-switch">
      <ThemeToggle />
    </div>
  </section>
);
```

## Patterns to follow
- DB layer: settings read via existing `/api/settings` — no new endpoints.
- Theme writing: only the parked `ThemeToggle` does it. Don't duplicate the POST.
- Atelier classes prefixed `atelier-settings-*` and CSS-scoped under `:root[data-theme="atelier"]`.
- `cookies()` reads via `getThemeCookie(cookieStore)` from `theme-cookie.ts`.
- No new npm deps.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-settings">` parallel to classic; classic untouched (extracted verbatim, no logic changes).
- [ ] `ThemeToggle` is prominently placed at the top of the Atelier tree (Section I., Visual Theme).
- [ ] Atelier Zero tokens applied (paper bg, Playfair italic, Roman numerals, hairline borders).
- [ ] Real settings data — system prompt + use-API toggle hit live `/api/settings`; sync info reflects real state.

## Verification
- `npm run build` clean.
- whoop-dev up → `/settings` classic unchanged: system prompt save/load works, use-API toggle works, line-of-best-fit setting persists in localStorage.
- Toggle Atelier → Atelier settings render; the toggle in Section I flips themes round-trip; reload preserves; α / β preview cards update active state.
- agent-browser screenshot of `/settings` in both modes.

## Out of scope (explicit)
- No edits to `ThemeToggle.tsx`, `theme-cookie.ts`, or `api/theme/route.ts`.
- No new settings endpoints.
- Notifications + Account sections are visual placeholders only — no settings persisted.
- No multi-user UI.
- No new npm deps.
- Sync section's "Sync now" button calls existing `/api/sync` — no progress polling UI in v1.

## Cross-cutting note
Extracting `ClassicSettings` from `settings/page.tsx` is the only change to existing classic code in this plan. It is pure refactor (move + rename, no logic edits). Build worker should diff to confirm no behavior change. This is the only issue in #166–#173 that converts an existing client page into a server wrapper; all other pages are already server components.
