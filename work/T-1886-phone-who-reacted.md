---
id: T-1886
title: "Phone: long-pressing a reaction chip shows who reacted (the web shows it on hover) as a muted line under the chips for 3 s, e.g. '👍 Ana, Luis'; a tap still toggles my reaction"
status: merged
milestone: M5
branch: task/T-1886-phone-who-reacted
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1886: Who reacted (phone)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** On the web, hovering a reaction chip shows who reacted (`title={reaction.reactors.join(', ')}`, `apps/web/src/components/ReactionChips.tsx:41`). The phone has no way to see it.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/reaction-chips.tsx`** (69 lines): each chip is a `Pressable` with `onPress` toggling my reaction (`:38-66`). It is `disabled` when there's no `onToggle`.
- **`UiReaction.reactors`** holds the reactors' display names, in first-reacted order (`packages/chat-core/src/types.ts:124-125`).
- **The chips render under the bubble** from `apps/mobile/src/components/chat/message-bubble.tsx:260-270`.

### Steps
1. **In `reaction-chips.tsx`:**
   - keep a `shown` state: `{ emoji, names } | null`;
   - each chip gets `onLongPress` (with `delayLongPress` 350), which sets it. Clear it after 3 s with a timer, cleared on unmount and on the next long-press;
   - while set, render one line under the chips: `<Text className="mt-1 text-[12px] text-muted-foreground" numberOfLines={2}>{emoji} {names.join(', ')}</Text>`, aligned like the chips (`self-end` for outgoing);
   - a chip must stay long-pressable even when it isn't togglable: drop `disabled`, and make `onPress` a no-op without `onToggle`.
2. **Add `accessibilityHint="Long press to see who reacted"`** to each chip.
3. **No tests** (UI). The file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/reaction-chips.tsx`
- `work/T-1886-phone-who-reacted.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A long press on 👍** shows "👍 Ana, Luis" under the chips for about 3 s.
- **A tap** still toggles my reaction.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/reaction-chips.tsx`:
  - added a `shown: { emoji, names } | null` state; each chip's `onLongPress` (with `delayLongPress={350}`) sets it.
  - the line hides after 3 s (`REACTORS_VISIBLE_MS = 3000`) via the project's `runLater`/`interruptFiber` helpers (`apps/mobile/src/lib/effect/timers.ts`): the effect's cleanup interrupts the pending timer on unmount and when a new long-press replaces the shown value, so the next long-press restarts the 3 s.
  - while set, one line renders under the chips: `<Text numberOfLines={2} className="mt-1 text-[12px] text-muted-foreground">👍 Ana, Luis</Text>`, with `self-end` when `outgoing`.
  - dropped `disabled`; `onPress` is now `() => onToggle?.(emoji)`, so a chip stays long-pressable when it isn't togglable and a tap still toggles when `onToggle` exists.
  - added `accessibilityHint="Long press to see who reacted"` to each chip.
- No tests, per the spec (UI change). File is 97 lines.

### Checks run
`pnpm gate` (from the repo root):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.6s)
PASS  lint  (1.1s)
PASS  typecheck  (5.8s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (3.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test files were run: the touched file is UI and has no test of its own.

Two earlier gate runs failed and were fixed: first the `effect` rule rejected a raw `setTimeout` ("needs Effect (H3)"), so I switched to `runLater`/`interruptFiber`; then `format` flagged the file, fixed with `pnpm exec prettier --write` on it. The final run above is the green one.

### Notes for the lead
- The spec says "with a timer"; the gate's Effect rule forbids `setTimeout` in `apps/mobile/src`, so I used the project's existing timer fiber (`runLater`) instead. Behaviour matches the spec: 3 s, cleared on unmount, restarted by the next long-press.
- I did not run the app on a phone, so the 3 s line and the long-press feel are covered by your phone smoke and Julio's live check.
- `title` on web uses `reaction.reactors.join(', ')`; here the line prefixes the emoji as specified, and `numberOfLines={2}` caps long lists.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1566b43a1`.

**Emulator, mock build, Ana's chat:**
- long-pressing ❤️ 2 shows "❤️ Ana, You" under the chips;
- the line is gone after 3 s;
- a tap on ❤️ removes my reaction (it shows 1, no longer highlighted).

**The two nits need no change:** the "long-press sheet" comment means the bubble's action sheet, and the timer race is a millisecond window.

