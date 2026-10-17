---
id: T-1933
title: "Web reactions: a + entry after the quick reactions opens a small dialog with the emoji grid so any emoji can be a reaction (twin of T-1932)"
status: merged
milestone: M5
branch: task/T-1933-web-reactions-any-emoji
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1933: React with any emoji (web)

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:**

> the reactions, need to add any emoji

T-1932 is the phone twin. Web offers only the six quick reactions.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/MessageActionsMenu.tsx`** (164 lines): the reaction row is `QUICK_REACTIONS.map((emoji) => <MenuEntry … onSelect={() => onReact(emoji)} className="key-icon flex size-7 … text-[17px] leading-none">…)` (`:110-121`). Props include `onReact` (`:48`).
- **`apps/web/src/components/message/MessageMenu.tsx`** (277 lines): it renders `{open && <MessageActionsMenu … onReact={(emoji) => { onClose(); onReact(emoji); }} …/>}` (`:162-`). It already keeps local state (`confirmOpen`, `:114`) and renders `ConfirmDialog`.
- **`apps/web/src/components/sticker/EmojiTab.tsx`:** `EmojiTab({ onEmoji }: { onEmoji: (emoji: string) => void })` (`:13`), the search plus category grid used by the sticker panel.
- **The kit `Dialog`** is `apps/web/src/components/ui/dialog.tsx`; it takes `open`, `onClose`, `title` and `size`.

### Steps
1. **`MessageActionsMenu.tsx`:** add an optional prop `onMoreReactions?: () => void`. When given, append one more `MenuEntry` after the quick reactions: the same `key-icon size-7` look, a lucide `Plus` icon, `ariaLabel="More reactions"`, disabled when `!canReact`, with `onSelect={onMoreReactions}`.
2. **`MessageMenu.tsx`:**
   - Add `const [pickerOpen, setPickerOpen] = useState(false);` and pass `onMoreReactions={() => { onClose(); setPickerOpen(true); }}`.
   - Render `<Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title="React" size="sm">` holding `<EmojiTab onEmoji={(emoji) => { setPickerOpen(false); onReact(emoji); }} />`. Give the grid a max height so the dialog fits, using the existing EmojiTab styling.
   - Check whether the component unmounts when the menu closes (`open && …`). If it does, keep the dialog outside that condition so it survives the menu closing.
3. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/web/src/components/MessageActionsMenu.tsx`
- `apps/web/src/components/message/MessageMenu.tsx`
- `work/T-1933-web-reactions-any-emoji.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The message menu's reaction row ends with a + key.** Clicking it closes the menu and opens a "React" dialog with the full emoji grid and search. Picking an emoji reacts with it and closes the dialog.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/components/MessageActionsMenu.tsx`**: added an optional
  `onMoreReactions` prop. When it is given, the reaction row ends with one more
  `MenuEntry` with the same `key-icon size-7` look, a lucide `Plus` icon,
  `ariaLabel="More reactions"`, `disabled={!canReact}` and
  `onSelect={onMoreReactions}`.
- **`apps/web/src/components/message/MessageMenu.tsx`**: added `pickerOpen`
  state and passed `onMoreReactions` to the menu; it closes the menu and opens
  the picker. Rendered `<Dialog open={pickerOpen} onClose={…} title="React"
  size="sm">` with `<EmojiTab>` inside; picking an emoji closes the dialog and
  calls the existing `onReact`.
- The dialog is rendered outside the `open && …` block. `MessageMenu` itself is
  always mounted by `MessageBubble` (it only receives `open`), so the picker
  survives the menu closing. The grid's height is bounded by EmojiTab's existing
  `max-h-[260px] overflow-y-auto` grid, and the dialog body scrolls.
- No tests, as the spec says (UI only). Both files stay under 400 lines
  (178 and 299).

### Checks run

- `pnpm install --frozen-lockfile`: done, no changes.
- First `pnpm gate`: `FAIL format` on
  `apps/web/src/components/message/MessageMenu.tsx` only.
- `pnpm exec prettier --write apps/web/src/components/message/MessageMenu.tsx`:
  file formatted.
- Final `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (0.9s)
  PASS  lint  (1.7s)
  PASS  typecheck  (7.5s)
  PASS  effect  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the gate reported no nearby web test files and
  the change is UI-only.

### Notes for the lead

- I did not add a separate max-height wrapper around `EmojiTab` because the
  component already caps its own grid at 260 px with scrolling, and `Dialog`
  caps the popup at 85 vh with a scrolling body; that covers the "fits" intent
  without touching a file outside the Allowed list.
- The `+` key is only drawn when `onMoreReactions` is passed; the only caller
  (`MessageMenu`) passes it, so the row always shows six quick reactions plus
  `+`.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `b8e7dca69`.
- **Checked in the web mock** (vite on the branch), on Marta's chat:
  - right-clicking a message shows the six quick reactions and a + key;
  - + closes the menu and opens the "React" dialog with search and the full grid;
  - searching "spain" leaves 🇪🇸, and clicking it reacted with it ("🇪🇸 1" under the bubble) and closed the dialog.

