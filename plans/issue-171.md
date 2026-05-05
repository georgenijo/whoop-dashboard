# Plan: Issue #171 — Atelier Zero: coach page

**Issues covered:** #171
**Primary file:** `apps/web/src/app/coach/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-171`
**Branch:** `issue/171-atelier-coach`
**Depends on:** #165

## Context

Port `mockup-coach.html` → React behind the Atelier flag. Classic coach uses `CoachWorkspace` (chat-bubble UI). Atelier reframes the same chat as a printed correspondence: Chapter Index sidebar (search + day-bucketed thread list), an editorial chat stream where each AI reply is a "PLATE Nº" article with lede + numbered list, and a composer styled like a letter footer. Headline: *"A correspondence with your body."*

## Files touched
- `apps/web/src/app/coach/page.tsx` — wrap existing `<CoachWorkspace>` in `<div className="classic-coach">`, append `<div className="atelier-coach">` rendering an Atelier client component fed the same data.
- `apps/web/src/components/coach/AtelierCoachWorkspace.tsx` *(new, `"use client"`)* — Atelier shell: Chapter Index column, chat column, meta column.
- `apps/web/src/components/coach/atelier/ChapterIndex.tsx` *(new)* — search + filter pills + bucketed thread list.
- `apps/web/src/components/coach/atelier/ChatStream.tsx` *(new)* — day-marker + msg user/ai rendering with editorial cards.
- `apps/web/src/components/coach/atelier/Composer.tsx` *(new)* — letter-footer styled input.
- `apps/web/src/app/theme.css` — append `.atelier-coach *` selectors.

## Architectural decisions

- **Decision: render BOTH client trees (classic `CoachWorkspace` + new `AtelierCoachWorkspace`) per the #165 visibility convention.** Both subscribe to the same hooks (`useCoachThread`) and so each has its own state. State doesn't sync across trees — when you toggle, you start fresh in the other tree. Acknowledged trade-off; switching themes mid-conversation in personal tooling is rare. Alternative considered: a single shared workspace component skinned via CSS — rejected because mockup layout (3-column with Chapter Index) diverges from current 2-column shell, requiring large component changes that would risk classic regression.
- **Decision: Atelier reuses `useCoachThread` hook unchanged.** Same DB tables, same send pipeline, same threads. UI shell is the only difference.
- **Decision: bucketing (Today / Yesterday / This week / Earlier) computed client-side in `ChapterIndex` from `thread.last_message_at` (or `created_at`).** Pure derived state; no server change.
- **Decision: filter pills in Chapter Index are decorative for now.** No `topic`/`tag` column on threads. Render the pills (All / Recovery / Sleep / Strain / Stress) but only "All" is interactive — others are visible non-interactive labels matching the editorial chrome. Document this as a future hook (auto-tagging by Haiku) — out of scope.
- **Decision: AI assistant message rendered as `.ed-card`** with plate strip, optional lede paragraph (first sentence), then the rest of the markdown. Reuse existing `marked` + DOMPurify pipeline (already used by classic). Wrap output in `.ed-card` shell; lede via JS (extract first `<p>` to set class).
- **Decision: search input filters threads client-side** by title substring. No server query change.
- **Decision: meta column (right side, mockup `col-meta`) is omitted in v1** — its content (citations, model badge, glance stats) needs additional plumbing not in scope. Render an empty `.atelier-coach-meta` aside or drop the third column from the grid. Recommended: drop the third column; mockup is aspirational. Document as out-of-scope for v1.

## Implementation steps

1. **`coach/page.tsx`** — render dual trees:
   ```tsx
   const threads = getChatThreads(user.id);
   const messages = getChatThreadMessages(user.id, activeThread.id);

   return (
     <>
       <div className="classic-coach">
         <CoachWorkspace key={activeThread.id} initialThreadId={…} initialThreads={threads} initialMessages={messages} />
       </div>
       <div className="atelier-coach">
         <AtelierCoachWorkspace key={activeThread.id} initialThreadId={…} initialThreads={threads} initialMessages={messages} />
       </div>
     </>
   );
   ```

2. **`AtelierCoachWorkspace.tsx`** *(new, `"use client"`)* — outer shell. Mirrors `CoachWorkspace` shape: same `initialThreadId`, `initialThreads`, `initialMessages`. Calls `useCoachThread`. Layout:
   ```tsx
   <div className="atelier-coach-shell">
     <ChapterIndex
       threads={threads}
       activeId={threadId}
       onSelect={handleSelectThread}
       onCreate={handleCreateThread}
       onDelete={handleDeleteThread}
     />
     <section className="atelier-coach-chat">
       <ChatStream messages={messages} bottomRef={bottomRef} />
       <Composer
         input={input}
         setInput={setInput}
         loading={loading}
         progressLabel={progressLabel}
         inputRef={inputRef}
         onSubmit={() => void send(input)}
         onKeyDown={handleKeyDown}
       />
     </section>
   </div>
   ```

3. **`ChapterIndex.tsx`** *(new)* — props: threads, activeId, callbacks. Local `useState` for search query. Group threads into buckets by recency. Render: eyebrow, headline, search input, decorative filter pills, bucketed thread list. Each thread row shows time · turn count · title preview. Active thread underlined / coral accent.

4. **`ChatStream.tsx`** *(new)* — props: `messages: ChatMessage[]`, `bottomRef`. For each message:
   - `role === "user"` → `.atelier-msg.user` with mono timestamp · name · plate label, then `.atelier-bubble` containing markdown-rendered content.
   - `role === "assistant"` → `.atelier-msg.ai` containing `<article className="atelier-ed-card">` with plate strip (Roman numeral, FIG. label, author "Coach · Sonnet 4.6"), then markdown body. First `<p>` gets `.lede` class.
   Day markers rendered between messages when day changes (compare `created_at` ISO date strings).
   Reuse existing markdown rendering (look for an existing helper in `MessageBubble.tsx`; if it's inline, hoist into `lib/coach/markdown.ts` *(new)* or inline the same `marked` + `DOMPurify` call here).

5. **`Composer.tsx`** *(new)* — props: input, setInput, loading, progressLabel, inputRef, onSubmit, onKeyDown. Letter-footer styled (`.atelier-composer`): textarea with `.wrap` shell, send button styled as Atelier "submit" pill, mono progress label below.

6. **`theme.css`** — append `.atelier-coach`, `.atelier-coach-shell` (CSS grid 2-col: 320px chapter / 1fr chat), `.atelier-msg.*`, `.atelier-bubble`, `.atelier-ed-card`, `.plate-strip`, `.lede`, `.data-grid`, `.atelier-composer`, etc. Mockup `mockup-coach.html` lines 1–250 has the full token block.

## Code structure (skeletons)

```tsx
// ChapterIndex.tsx
type Bucket = "Today" | "Yesterday" | "This week" | "Earlier";
function bucketOf(iso: string): Bucket { /* compare to today */ }
const grouped = new Map<Bucket, ThreadSummary[]>();
for (const t of threads) {
  const key = bucketOf(t.last_message_at ?? t.created_at);
  (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(t);
}
```

```tsx
// ChatStream.tsx — assistant message
<article className="atelier-ed-card">
  <span className="bk-bl"/><span className="bk-br"/>
  <div className="plate-strip">
    <span className="roman">{toRoman(idx)}</span>
    <span>FIG. {fig} / {threadLabel}</span>
    <span className="author">Coach · Sonnet 4.6</span>
  </div>
  <div
    className="atelier-ed-body"
    dangerouslySetInnerHTML={{ __html: renderMarkdownWithLede(message.content) }}
  />
  <div className="ann"><span className="fin">— fin.</span></div>
</article>
```

## Patterns to follow
- DB layer untouched; uses existing `getChatThreads`, `getChatThreadMessages`.
- Coach hooks unchanged; reuse `useCoachThread`.
- Markdown rendering: same `marked` + `DOMPurify` config as classic `MessageBubble`.
- All Atelier classes prefixed `atelier-coach-*` (or `atelier-msg`, `atelier-ed-card`, `atelier-composer` for chat-stream subcomponents) and CSS-scoped under `:root[data-theme="atelier"]`.
- No new npm deps.
- Roman numerals: small helper inline (`["I","II","III","IV","V","VI","VII","VIII","IX","X"][n]` with fallback) — no `roman-numerals` dep.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-coach">` parallel to classic; classic untouched.
- [ ] Atelier Zero tokens (paper bg, Playfair italic, Roman numerals, hairline borders, coral accent).
- [ ] Letter/correspondence aesthetic — assistant messages render as plated editorial cards, not chat bubbles.
- [ ] Real insight + thread data — chapter index lists actual threads bucketed by recency; chat stream renders existing thread messages.

## Verification
- `npm run build` clean.
- whoop-dev up → `/coach` classic unchanged; threads + send + delete still work.
- Toggle to Atelier → Atelier shell renders existing threads in chapter index; opening a thread shows messages as editorial plates; sending a new message persists and re-renders.
- agent-browser screenshot atelier `/coach`; cross-check against `mockup-coach.html`.

## Out of scope (explicit)
- No edits to `CoachWorkspace`, `MessageBubble`, `MessageList`, `ThreadSidebar`, `ChatInput`, or `useCoachThread`.
- No new DB columns (no `topic` tag for filter pills — pills are decorative for v1).
- No "meta column" with citations/glance widgets (mockup col-meta dropped for v1).
- No model toggle, no streaming UI changes, no tool-result inspection (uses existing rendering from classic).
- No new npm deps.

## Note on dual-mount
Both `CoachWorkspace` and `AtelierCoachWorkspace` mount as React trees on every page load. Each has its own `useCoachThread` state. Resource cost is one extra `useCoachThread` instance — acceptable for a single-user app. Toggling theme mid-conversation will reset state in the newly-visible tree (it re-mounts since `display: none → block` does not unmount, so state actually persists per-tree across toggles within a session).
