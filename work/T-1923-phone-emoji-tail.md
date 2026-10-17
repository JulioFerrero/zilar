---
id: T-1923
title: "Phone bubbles: a lone big emoji shows whole (no clipped top) and gets no bubble tail; stickers and caption-less photos get no tail either"
status: merged
milestone: M5
branch: task/T-1923-phone-emoji-tail
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1923: Big emoji not clipped; no stray bubble tail

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on an iPhone 16 Pro (v0.2.9).** Two problems with a lone big emoji:
- its top is cut off;
- a small white bubble "tail" sits beside its time pill, with no bubble around it.

The same white tail hangs off the corner of a photo with no caption.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/message-bubble.tsx`** (370 lines):
  - `hasText` (`:107`), `bigEmoji` (`:116-123`), `sticker = stickerOf(message)` (`:126`) and `mediaFirst = isMediaFirstMessage(...)` (`:73`);
  - the body picks a sticker, a standalone card, `BigEmojiBubble` or the normal bubble (`:198-250`);
  - after that, `{isLastInGroup ? <BubbleTail outgoing={outgoing} color={outgoing ? '#dedede' : …} /> : null}` (`:251-258`) draws the tail for **every** kind. That includes the big emoji and the sticker, which have no bubble, and a photo, which covers the bubble.
- **`apps/mobile/src/components/chat/message-bubble-decor.tsx`** (168 lines): `BigEmoji` renders the text with `className="px-2 py-1 text-[48px] leading-none text-foreground"` (`:147`). A 48 px line box is shorter than the emoji glyph, so iOS clips its top.
- **Web is already right:** `apps/web/src/components/MessageBubble.tsx:281` gives `bigEmoji` and standalone cards no bubble look, so no tail. No web change.

### Steps
1. **`message-bubble.tsx`:** draw `BubbleTail` only when all of these hold:
   - `isLastInGroup`;
   - `sticker === undefined`;
   - `!bigEmoji`;
   - `!(mediaFirst && !hasText)`. A photo, album or GIF with no caption has no tail; with a caption the white caption area keeps it.

   Keep everything else as it is.
2. **`message-bubble-decor.tsx:147`:** replace `leading-none` with `leading-[60px]`, so the whole 48 px emoji fits on iOS and Android. Keep `px-2 py-1 text-[48px]`.
3. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `work/T-1923-phone-emoji-tail.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A message that is one emoji shows the whole emoji, top included.
- There is no white tail next to a big emoji or a sticker, or under a photo, album or GIF without a caption.
- Text bubbles and photos with a caption keep their tail.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/message-bubble.tsx`: added `showTail`, true only when `isLastInGroup && sticker === undefined && !bigEmoji && !(mediaFirst && !hasText)`, and used it in place of `isLastInGroup` for `<BubbleTail>` (`:141-144`, `:254`). Text bubbles and media with a caption keep the tail; stickers, a lone big emoji, and photo/album/GIF without a caption no longer draw one.
- `apps/mobile/src/components/chat/message-bubble-decor.tsx:147`: `BigEmoji` line height changed from `leading-none` to `leading-[60px]` (kept `px-2 py-1 text-[48px]`), so the 48 px glyph fits in its line box.
- No tests: UI change, as the spec says. Both files stay under 400 lines (374 and 168).

### Checks run
- `pnpm install`: "Done in 17.2s".
- First `pnpm gate`: `FAIL format` (`message-bubble.tsx`), everything else passing. Fixed with `pnpm exec prettier --write apps/mobile/src/components/chat/message-bubble.tsx`.
- Second `pnpm gate` (from repo root), real output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.2s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (1.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The three changed files are the two allowed source files and this task file.
- No single test files were run: the spec says no tests, and the gate ran the mobile package tests.

### Notes for the lead
- The spec's condition was implemented exactly; standalone cards and the handoff line still draw a tail as before (spec said keep everything else as is).
- Not verified on a device: the whole-glyph fix and the missing tails need the lead's phone smoke test.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ebc15c63a`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Checked on screen:** I sent a lone emoji from the emoji sheet. It renders whole at 48 px with its top intact, and only the time pill sits under it, with no white tail.
- **Code:** exactly the spec. `showTail` drops the tail for stickers, big emoji and caption-less media, and `leading-[60px]` replaces `leading-none`.
- The iOS clipping Julio saw can only be confirmed on the iPhone, with the next iOS build.

