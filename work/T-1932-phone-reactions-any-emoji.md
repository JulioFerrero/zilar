---
id: T-1932
title: "Phone reactions: a + key after the quick reactions opens the full emoji grid in the message sheet so any emoji can be a reaction; reaction emoji are no longer clipped at the top"
status: merged
milestone: M5
branch: task/T-1932-phone-reactions-any-emoji
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1932: React with any emoji (phone), no clipped tops

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:**

> the reactions, need to add any emoji and have the same problem where the top part is cut

Today only the six quick reactions exist. Their emoji, and those in the chips under bubbles, use `leading-none`, which clips the glyph top on iOS (the same cause as T-1923).

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/message-actions-sheet.tsx`** (286 lines): the sheet `header` is a toolbar row of `QUICK_REACTIONS.map(...)` buttons (`:129-160`). Each is a `h-11 w-11` `Pressable` that calls `onReact(emoji)`, with `<Text className="text-[20px] leading-none">{emoji}</Text>` (`:156`). The actions list follows.
- **`packages/chat-core/src/reactions.ts:2`:** `QUICK_REACTIONS = ['👍','❤️','😂','😮','😢','🙏']`.
- **`apps/mobile/src/components/chat/reaction-chips.tsx:72`:** `<Text className="text-[13px] leading-none">{reaction.emoji}</Text>`.
- **`apps/mobile/src/components/chat/emoji-tab.tsx`:** `EmojiTab` takes `{ open, recents, activeCategory, onSelectCategory, onPick }` (`:38-49`). It is the composer's emoji grid, with search and categories.

### Steps
1. **`message-actions-sheet.tsx`:**
   - After the six quick buttons, add a seventh button of the same size: lucide `Plus`, `accessibilityLabel="More reactions"`, disabled when `!canReact`. It sets a local `pickerOpen` state to true.
   - While `pickerOpen`, the sheet body (the actions list) is replaced by a `View` of height 360 holding `<EmojiTab open recents={[]} activeCategory={category} onSelectCategory={setCategory} onPick={(emoji) => onReact(emoji)} />`, with local `category` state starting at `'smileys'`.
   - `onReact` already closes the menu. Reset `pickerOpen` to false whenever `visible` turns false.
2. **The clipped tops:**
   - `message-actions-sheet.tsx:156` becomes `text-[20px] leading-[26px]`;
   - `reaction-chips.tsx:72` becomes `text-[13px] leading-[17px]`.
3. **No tests** (UI). Files stay at most 400 lines. If `message-actions-sheet.tsx` would pass 400, move the reaction row into a new `apps/mobile/src/components/chat/reaction-bar.tsx`.

### Allowed files
- `apps/mobile/src/components/chat/message-actions-sheet.tsx`
- `apps/mobile/src/components/chat/reaction-chips.tsx`
- `apps/mobile/src/components/chat/reaction-bar.tsx`
- `work/T-1932-phone-reactions-any-emoji.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The quick row has a + key.** Tapping it shows the full emoji grid (search and categories) in the sheet, and tapping any emoji reacts with it and closes the sheet.
- **Whole emoji:** the quick reaction emoji and the chips under bubbles show whole, with no cut tops.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/message-actions-sheet.tsx`:
  - Added a seventh key to the quick-reaction toolbar, the same `h-11 w-11` size as the six: a lucide `Plus` with `accessibilityLabel="More reactions"`, disabled when `!canReact`, which opens the full emoji grid.
  - The sheet body now switches to a 360 px `View` holding `<EmojiTab open recents={[]} activeCategory={category} onSelectCategory={setCategory} onPick={onReact} />` (search and categories included), with local `category` state starting at `'smileys'`. Picking an emoji calls `onReact`, which the parent already uses to close the sheet.
  - `pickerOpen` resets to false during render whenever `visible` is false (React's adjust-state-during-render pattern, as in `contact-list.tsx`), so no effect synchronizes state and a reopen starts on the actions.
  - The actions rows are built as a flat array instead of a fragment: `ActionSheet` draws a divider per direct child and counts a fragment as one child, so a fragment would have removed the dividers between the rows.
  - The file is 357 lines, under the 400-line cap, so no `reaction-bar.tsx` was needed.
- `apps/mobile/src/components/chat/reaction-chips.tsx`: the chip emoji is now `text-[13px] leading-[17px]` instead of `leading-none`, so the glyph top is no longer clipped on iOS.
- The quick-reaction emoji in the sheet are now `text-[20px] leading-[26px]` instead of `leading-none`, same fix.
- No tests added: the spec says UI, and AGENTS.md says UI code gets no tests.

### Checks run
- `pnpm install`: done, 17.5 s, no errors.
- `pnpm gate` (run twice; the first run failed lint on `react(set-state-in-effect)` because the reset was an effect, fixed by resetting during render):
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (6.2s)
PASS  effect  (1.1s)
PASS  tests @zilar/mobile  (3.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
- No single test file was run separately; this is a UI-only change and the gate ran the mobile package tests.

### Notes for the lead
- I did not run the app on a phone or simulator, so the visual result (whole emoji, grid height) is unverified on device; that needs the lead's phone smoke.
- The seven 44 px keys fit a 360 pt-wide phone with the row's `px-2`; on a 320 pt screen the row would be ~4 px wider than the available space. The spec asked for a same-size seventh key, so I kept `h-11 w-11` for all seven.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `7127dcc37`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Checked on screen:**
  - long-pressing a message shows the six quick reactions (whole, not clipped) and a + key;
  - + swaps the actions for the full emoji grid with search and categories;
  - picking 😀 reacted with it and closed the sheet, and its chip under the bubble shows the emoji whole.
- **Left as is:**
  - the empty Recent tab (`recents={[]}`);
  - the "Insert" accessibility label in the grid;
  - possible small-screen width. These are pre-review nits and the follow-up for `emoji-tab.tsx`.

