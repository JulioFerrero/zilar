---
id: T-1619
title: "Phone: the AI work card stands alone like the approved View steps board — rendered without the bubble surface (as a sticker is), no BubbleMeta time/'edited' row under it (twin of T-1618)"
status: merged
milestone: M5
branch: task/T-1619-phone-work-card-standalone
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1619: The phone work card has no bubble around it

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio sent a screenshot of the AI work card drawn as a "double bubble": the card inside a normal incoming bubble, then text and an "edited 01:05" meta row under it.

The approved design (`docs/design/mockups/view-steps/Phone.dc.html`, and the web boards `docs/design/mockups/view-steps/Main.dc.html:38-57` and `docs/design/mockups/ai-work/Main.dc.html:86-100`, approved 2026-10-15) shows the card alone next to the AI's picture. Read them with `git show main:<path>`. T-1618 is the web twin. **Don't change the card's content here.**

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/message-bubble.tsx`** (377 lines):
  - a sticker renders without a bubble (`:152-156`: "A sticker renders without a bubble …"), via `StickerBubble` (`:195-205`);
  - `bigEmoji` (`:144-151`) also skips it.
- **`apps/mobile/src/components/chat/message-bubble-content.tsx`** (330 lines): `:182-190` is the card branch, `message.card && isRenderedCard(message.card)`, which renders `<PayloadCard card={message.card} />` and then a `BubbleMeta` row (time, "edited", ticks).
- **`apps/mobile/src/components/chat/payload-card.tsx`:** `PayloadCard` draws `progress`, `approval.request` and `question`.

### Steps
1. **A message whose card is `progress`** renders without the bubble surface, the way a sticker or big emoji skips it.
   - Only the `ProgressCard` shows, aligned and with the avatar column as for other incoming messages.
   - The long-press menu and the group sender handling stay as they are for stickers.
2. **No `BubbleMeta` row for a `progress` card:** no clock time and no "edited". Approval and question cards keep theirs.
3. **Change nothing else.**

### Tests
None (UI). The lead checks it on the emulator.

### Allowed files
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `work/T-1619-phone-work-card-standalone.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A progress-card message shows only the card:** no outer bubble and no time or "edited" row.
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

A message whose card is `progress` now renders without the bubble surface, the
way a sticker or big emoji skips it, and without a `BubbleMeta` row.

- `apps/mobile/src/components/chat/message-bubble.tsx`: added
  `const standaloneCard = message.card?.type === 'progress'`. When it is true,
  `bubbleColumn` renders the body inside a bare `Pressable` (long-press menu and
  accessibility label as before) with no `rounded-[14px]`/`bubbleStyle` surface.
  The sender-name/forward/reply/avatar/tail handling is unchanged, so alignment
  matches any other incoming message. Extracted the `MessageMenuProvider` +
  `MessageBubbleContent` block into one `bubbleBody` node and reused it in both
  the standalone branch and the normal bubble branch (keeps the file at 392
  lines, under the 400 limit).
- `apps/mobile/src/components/chat/message-bubble-content.tsx`: the card branch
  now skips `BubbleMeta` when `message.card.type === 'progress'` (no clock time,
  no "edited"). Approval and question cards keep their meta row.
- `apps/mobile/src/components/chat/payload-card.tsx`: added `ProgressCardSurface`,
  which wraps `ProgressCard` in the incoming-bubble surface
  (`bubbleStyle('incoming', false)`, `rounded-[12px] p-2.5`). This is now the
  card's only box, matching the approved mockups (card alone next to the AI
  picture, own surface) and the web twin's `bubble-in rounded-[12px] p-2.5`.
  `ProgressCard`'s content is untouched.

No change to how approval/question cards, stickers, big emoji or text messages
render.

### Checks run

- `pnpm gate` (from repo root), real output:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (1.4s)
PASS  typecheck  (4.0s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single tests run near the change: none. The touched files are UI
  (`message-bubble`, `message-bubble-content`, `payload-card`) and have no test
  files; the spec says UI gets no tests. `pnpm gate` ran the mobile package's
  tests (`tests @zilar/mobile` passes).
- Final line counts: `message-bubble.tsx` 392, `message-bubble-content.tsx` 334,
  `payload-card.tsx` 64 — all under 400.

### Notes for the lead

- Not verified on the emulator (I cannot run it); the lead should smoke-test a
  real progress card in an AI DM/group.
- Design decision I had to make: the phone `ProgressCard` had no surface of its
  own (unlike the web `ProgressCard`, which ships `bubble-in rounded-[12px]
  p-2.5`), so removing the outer bubble would have left it floating with no
  background. I gave it the incoming-bubble surface in
  `payload-card.tsx:ProgressCardSurface`, matching the web twin and the mockups.
  `ProgressCard`'s content is unchanged, per the spec. If the lead wanted a
  different surface (e.g. the flat `#141414`/`#232323` from the mockup instead of
  the app's incoming gradient), that is a one-line change in that wrapper.
- `message-bubble.tsx` now routes a progress card away from
  `MessageBubbleContent`'s card branch, but I still added the progress guard
  there for `BubbleMeta` (step 2) so the rule holds wherever a progress card
  reaches that branch.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits.
- **The emulator check:** `ZILAR_SMOKE_MOCK=1 ZILAR_ROUTES="/chat/ai-dev-1%40zilar.test" pnpm phone:smoke` passed. In the screenshot, Dev-1's card ("✓ Reviewing the open … 2:14 · View steps") is one box, with no outer bubble and no time or "edited" row.
- **Separate from this task:** the card's title is cut off at the card's width, and the content redesign waits on Julio's canvas.
- **Live web counterpart (T-1618):** a real card in "ai test › General" now shows no bubble and no fallback text.

