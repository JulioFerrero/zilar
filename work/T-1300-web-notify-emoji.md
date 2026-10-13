---
id: T-1300
title: "Web: the Notifications page lists muted chats with Unmute (WUX-39); the emoji tab gets a search box and categories (WUX-26); small copy nits (WUX-43)"
status: merged
milestone: M5
branch: task/T-1300-web-notify-emoji
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1300: Muted chats list, emoji search, copy nits (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-39** (P3, `:139`): there's no per-chat mute list on the Notifications page. Mute lives only in the row menus (`apps/web/src/components/ChatActionsMenu.tsx`), so there's no way to see what's muted.
- **WUX-26** (P3, `:79`): the emoji tab is a fixed list of common emoji (`apps/web/src/components/sticker/emoji.ts`), with no search or categories.
- **WUX-43** (P3, `:149`):
  - the "Mute…" label flips to "Mute" by state (`ChatActionsMenu.tsx`);
  - the "CHANNEL"/"PUBLIC" tags use the same all-caps mono style as the role chips, which mean something else.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-39:** a "Muted chats" section on the Notifications settings page (find the route) listing muted chats, each with its mute end ("until 18:00", "always"), plus an Unmute button using the existing unmute action (cite it). If none are muted, say "No muted chats."
2. **WUX-26:**
   - a search box over the emoji tab that filters by name. If `emoji.ts` has no names, add a compact name per emoji in that file, keeping it at most 400 lines (generated data is exempt: say so if you go over);
   - group the emoji into a few categories (smileys, people, nature, food, activities, objects, symbols) with tabs or headers.
   - No new dependency.
3. **WUX-43:**
   - the mute menu label reads "Mute…" when unmuted and "Unmute" when muted;
   - the channel and public tags become sentence-case muted text ("Channel", "Public"), distinct from the role chips.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:79`, `:139`, `:149`), `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/sticker/emoji.ts` and the Notifications settings page (find it).

### Allowed files
`apps/web/src/components/**/*.tsx`, `apps/web/src/components/sticker/*.ts`, `apps/web/src/routes/**/*.tsx`, `work/T-1300-web-notify-emoji.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - mute a chat, and it shows on the Notifications page with Unmute;
  - typing "heart" in the emoji tab finds ❤️.

---

## Report (written by the worker when done)

### Recheck on main (before building)
- **WUX-39** (confirmed): `apps/web/src/components/ChatActionsMenu.tsx` had mute only in the row/header menus; there was no mute list on `NotificationsPage`.
- **WUX-26** (confirmed): `apps/web/src/components/sticker/emoji.ts` was a flat `COMMON_EMOJI` list of 31 glyphs, no names, no search, no categories.
- **WUX-43** (confirmed): `ChatActionsMenu.tsx` showed `Mute…` when muted and `Mute` when unmuted (backwards); `ChatListItem.tsx` / `ChatHeader.tsx` drew `CHANNEL`/`PUBLIC` with the same `font-mono` bordered chip style the role chips use.

### What I did
- **WUX-39** — `apps/web/src/components/push/MutedChatsSection.tsx` (new), rendered at the end of `apps/web/src/routes/NotificationsPage.tsx`. It selects `chats` and `chatPrefs` from the store, lists chats muted by their own pref (a group mute sits on the General row; inherited topics are skipped so the group is not repeated), shows the mute end (`until 18:00` via `formatListTime`, or `always` for the far-future `forever` sentinel), and unmutes with the existing store action `setMuted(chatId, null)` (`store/effects/prefs.ts:126`), the same one the row menu uses. Empty state: "No muted chats." A failed unmute shows the fixed sentence "Could not unmute. Try again."
- **WUX-26** — rewrote `apps/web/src/components/sticker/emoji.ts` to export `EMOJI` (names + one of 7 categories) and `EMOJI_CATEGORIES`; new `apps/web/src/components/sticker/EmojiTab.tsx` renders a search box (`SearchField`, filters by name; typing "heart" matches ❤️ "red heart") and category headers. `StickerPanel.tsx` now renders `<EmojiTab onEmoji={onEmoji} />` and dropped the old inline grid. No new dependency. `emoji.ts` is 134 lines (hand-curated, not generated), under the 400-line cap.
- **WUX-43** — `ChatActionsMenu.tsx`: label is `Mute…` when unmuted (opens the duration list) and `Unmute` when muted (direct `setMuted(id, null)`); the fade-out `data` no longer toggles the wrong way. `ChatListItem.tsx` and `ChatHeader.tsx`: `CHANNEL`/`PUBLIC` became sentence-case muted text `Channel`/`Public`, no mono/border chip, so they are distinct from the role chips.

### Files changed
- `apps/web/src/components/push/MutedChatsSection.tsx` (new)
- `apps/web/src/components/sticker/EmojiTab.tsx` (new)
- `apps/web/src/components/sticker/emoji.ts`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/components/ChatActionsMenu.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `work/T-1300-web-notify-emoji.md`

### Commands
- `pnpm install`: 1181 packages, done (first run).
- Single tests: none — the change is UI only and there is no nearby test file for these components (gate reported `SKIP tests @zilar/web (no nearby test files)`).
- `pnpm gate` (repo root): first run FAILed only on `format` (prettier in `emoji.ts`) and then on `lint` (`react(purity)`: `Date.now()` during render in `MutedChatsSection.tsx`). Both fixed. Final run:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (8.0s)
  PASS  effect  (1.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes
- The mute menu now unmutes directly when muted (it previously opened the duration list, whose only use then was Unmute). Muting with a chosen duration is still offered when unmuted. This matches the spec wording ("Mute…" when unmuted, "Unmute" when muted) and Telegram.
- `emoji.ts` was expanded from 31 to 104 curated glyphs so the categories are not near-empty; names are lowercase for search.
- No migration, no dependency, no tests (UI).

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits).**
- **Lead's check on the web mock:**
  - I muted Marta for 8 hours from the row menu; Notifications → Muted chats lists "Marta, until 09:33" with Unmute;
  - Unmute empties the list ("No muted chats.");
  - in the Emoji tab, "heart" finds 🥰 🫶 ❤️ 💔.
- **Lead's checks after the rebase:** web tsc: 0 errors. The largest touched file is `ChatHeader.tsx` at 365 lines.
