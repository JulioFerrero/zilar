---
id: T-1972
title: "Web parity: Explore becomes a page at /explore (own URL, browser Back works) instead of an overlay, like the phone"
status: merged
milestone: M5
branch: task/T-1972-web-explore-page
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-1972: Explore as a page on web

## Spec (written by Claude, do not edit)

### Why
Julio chose this on 2026-10-18 from the Telegram/WhatsApp gaps in `docs/audit/ui-consistency.md` §6, item 4.

- **The phone** opens Explore as a route (`apps/mobile/src/app/explore.tsx`).
- **Web** opens it as a `Dialog`, so it has no URL, and browser Back leaves the app view instead of closing it. Telegram desktop uses a page.

### Facts (read by the lead on 2026-10-18; paths under `apps/web/src/`)
- **`components/ExplorePage.tsx`** (306 lines):
  - `export function ExplorePage({ onClose })` (`:65`) wraps everything in `<Dialog open onClose={onClose} …>` (`:169-286`), with a footer Button that calls `onClose` (`:177`).
  - Opening or joining a group calls `onClose()` after it navigates (`:139`, `:155`).
- **Who opens it:**
  - `components/ChatList.tsx` keeps `exploreOpen` state (`:46-47`), sets it from three places (`:127`, `:187`, `:191`), and renders `{exploreOpen && <ExplorePage …/>}` at `:193`.
  - `components/NewChatButton.tsx` uses `onExplore` when it is given, and otherwise its own `'explore'` dialog (`:76-86`, `:213`).
- **Routes:** `routes/AppRoutes.tsx` (354 lines) declares each settings page as `<Route path="/settings/…" element={<RequireAuth>…</RequireAuth>} />` (`:156-290`). The `/:atHandle` catch-all is at `:287`.
- **The page frame:** `components/SettingsShell.tsx` takes `onBack` and renders the shared 64 px `ScreenHeader` (T-1949).

### Steps
1. **`ExplorePage.tsx`:** split the body out of the `Dialog`.
   - Export `ExploreContent({ onDone })`, which is everything inside the dialog: search, the All/Groups/Channels filter, and the list with Join/Open. Keep the behaviour.
   - Drop the `Dialog` and the "Close" footer.
   - `onDone` runs where `onClose` ran after open/join.
2. **New `routes/ExploreRoute.tsx`:** render `ExploreContent` inside `SettingsShell`.
   - The title is "Explore", with the subtitle "Public groups and channels anyone can join".
   - `onBack` goes back in history, or to `/` when there is none.
   - `onDone` does nothing extra; the join or open already navigated.
3. **`AppRoutes.tsx`:** add `/explore` with `RequireAuth`, before the `/:atHandle` catch-all, lazy like the settings pages.
4. **`ChatList.tsx` and `NewChatButton.tsx`:** every Explore opener does `navigate('/explore')`. Remove `exploreOpen` and the `'explore'` dialog branch.
5. **No tests** (UI). Every file stays at or under 400 lines; `AppRoutes.tsx` will be about 362.

### Allowed files
- `apps/web/src/components/ExplorePage.tsx`
- `apps/web/src/routes/ExploreRoute.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/NewChatButton.tsx`
- `work/T-1972-web-explore-page.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks the web mock at 1440 and 390 px:
- the menu's Explore opens `/explore` as a page with the shared header;
- browser Back returns to the chat list;
- Join and Open still work, and Open lands in the group;
- a reload on `/explore` shows the page.

The gate passes.

---

## Report (written by the worker when done)

### What I did

- `components/ExplorePage.tsx`: replaced the exported `ExplorePage({ onClose })` dialog with `ExploreContent({ onDone })`. The body (search field, All/Groups/Channels filter, result list with Join/Open, empty/error/Show more states) is kept as is; the `Dialog`, the "Close" footer and the in-dialog subtitle are gone. `onDone` runs where `onClose` ran after Open and Join, and both still navigate to the chat. The body now uses the shared `SETTINGS_COLUMN` wrapper and drops the dialog's own scroll container, since the page shell scrolls.
- `routes/ExploreRoute.tsx` (new): renders `ExploreContent` inside `SettingsShell` with title "Explore" and subtitle "Public groups and channels anyone can join". `onBack` does `navigate(-1)` when there is history, else `navigate('/')`. `onDone` is a no-op because Join/Open already navigated.
- `routes/AppRoutes.tsx`: added a lazy `ExploreRoute` and `<Route path="/explore" element={<RequireAuth><ExploreRoute /></RequireAuth>} />` before the `/:atHandle` gate. File is 362 lines.
- `components/ChatList.tsx`: removed `exploreOpen` state and the `ExplorePage` render; all three openers (menu, empty state, `NewChatButton`) now call `navigate('/explore')`.
- `components/NewChatButton.tsx`: removed the `'explore'` dialog branch and the `ExplorePage` import; the Explore menu entry calls `onExplore` when given, otherwise `navigate('/explore')`.

### Checks run

- `pnpm install`: done, 1155 packages.
- Single test files: none run — this is UI work and the gate reported no nearby test files.
- `pnpm gate` from the repo root:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.6s)
PASS  lint  (1.1s)
PASS  typecheck  (1.0s)
PASS  effect  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

(The gate was run again after this Report was written and passed with the same lines; only the timings vary a little.)

### Notes for the lead

- I did not open a browser or run the web mock, so the 1440/390 px visual check and the Back/Join/Open/reload walkthrough are still for you. What I verified is the gate (format, lint, typecheck) and the code paths: `/explore` is a `RequireAuth` route, Back falls back to `/` without history, and both Join and Open still navigate after `onDone`.
- `ExploreContent` no longer autofocuses the search field (the dialog used `initialFocusRef`); the page follows the other settings pages and leaves focus alone.
- The content column is width-limited by `SETTINGS_COLUMN`, matching the other settings pages; the old dialog body had no max width.
- No deviations from the spec and no new dependencies.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean.

**What the lead checked** (web mock, Playwright, `7a77afb22`):
- menu > Explore opens `/explore` as a page, with the shared 64 px header, the search, the All/Groups/Channels segmented control and the list;
- browser Back returns to the chat list;
- a reload on `/explore` shows the page;
- at 390 px the page fits, with no overflow.

**Found and not caused by this task:** Open on a joined *channel* (Acme Announcements) lands on `/` with no chat selected. Main behaves the same with the old overlay.
- **Cause:** `refreshGeneralTopic` (`apps/web/src/store/effects/topics.ts:23-32`) only finds a group's General topic row, and a channel's row has no topic.
- **Fix:** T-1974.
