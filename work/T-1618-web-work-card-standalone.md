---
id: T-1618
title: "Web: the AI work card stands alone like the approved View steps board — no message bubble around it, no repeated fallback text ('Running a command') under it, no time/'edited' meta row"
status: merged
milestone: M5
branch: task/T-1618-web-work-card-standalone
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1618: The web work card has no bubble around it

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio sent a screenshot of an AI work card: "double bubble … this i mean". One message showed three things stacked:
- the work card ("✓ Running a command 0:08", "View steps ›") **inside** a normal incoming bubble;
- the message's fallback text "Running a command" again under the card;
- a meta row reading "edited 01:05".

The approved design (`docs/design/mockups/view-steps/Main.dc.html:38-57`, approved 2026-10-15, and the working card in `docs/design/mockups/ai-work/Main.dc.html:86-100`) shows the card on its own next to the AI's 28 px picture: no bubble, no text under it, no time row. The card's own timer is the time. Read both with `git show main:<path>`.

(The card's title and step text are a separate redesign waiting for Julio. **Don't change `ProgressCard`'s content here.**)

### Facts (the lead read them on 2026-10-16)
- **`apps/web/src/components/MessageBubble.tsx`** (372 lines):
  - `:128`: `const bodyText = hasText && !hidesBodyText(message.card);`
  - `:269-285`: the bubble surface classes (`bubble-in`, `rounded-[14px]`, …), skipped only when `bigEmoji`;
  - `:304-330`: `AttachmentBody`, then `MessageTextBody`.
- **`apps/web/src/components/message/QuestionCard.tsx:11-13`:** `hidesBodyText(card)` returns `card?.type === 'question'` only.
- **`apps/web/src/components/message/AttachmentBody.tsx`** (302 lines):
  - `:246-248` puts `<ProgressCard>` in a `px-3 py-1.5` box inside the bubble;
  - `:266-277` draws a `MessageMeta` row for a card with no text, which shows "edited" when the message was edited (the progress card is updated by editing its message).

### Steps
1. **`hidesBodyText`** returns true for `progress` cards too, so the fallback text is never drawn under the card. Copying the text and search still use it, as for questions.
2. **A message whose card is `progress`** renders without the bubble surface, the way `bigEmoji` skips it (`MessageBubble.tsx:269-285`). `ProgressCard`'s own surface is the only box, with no extra padding box around it.
   - Keep the group sender name and the avatar column exactly as other incoming messages do.
   - Hover and the message menu must still work.
3. **No `MessageMeta` row for a `progress` card** (`AttachmentBody.tsx:266-277`): no clock time and no "edited". Approval and question cards keep theirs.
4. **Change nothing else.**

### Tests
None (UI). The lead checks a real progress card in a browser.

### Allowed files
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/QuestionCard.tsx`
- `work/T-1618-web-work-card-standalone.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A progress-card message shows only the card:** no outer bubble, no fallback text and no time or "edited" row.
- **Other cards and messages are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

1. **`apps/web/src/components/message/QuestionCard.tsx`** — `hidesBodyText` now returns true for `progress` cards as well as `question` cards, so the message's fallback text ("Running a command") is never drawn under the work card. `hasText` is still passed to copy/search as before.
2. **`apps/web/src/components/MessageBubble.tsx`** — added a `standaloneCard = message.card?.type === 'progress'` flag. When it is set, the message draws no bubble surface: `data-bubble-look` is omitted and the bubble classes (`rounded-[14px]`, `bubble-in`/`bubble-out`/`bubble-gen`, tail corner) are skipped, exactly the way `bigEmoji` skips them. The group sender name and the avatar column are unchanged, and the actions button/menu stay inside the (still `relative`, `group`) column so hover and the menu work as before.
3. **`apps/web/src/components/message/AttachmentBody.tsx`** — a `progress` card is no longer wrapped in the `px-3 py-1.5` inner padding box (only the other cards get it), so the card's own surface (`ProgressCard`, `bubble-in rounded-[12px] p-2.5`) is the only box. The `MessageMeta` row is now skipped for a `progress` card, so no clock time and no "edited"; approval and question cards keep theirs.
4. `ProgressCard` content (title/steps) was not touched, per the spec.

### Checks run

- `pnpm gate` (from the repo root): **GATE PASS**. Summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.9s)
  PASS  effect  (1.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says "Tests: None (UI)" and the gate itself reported `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm exec prettier --write` on the three source files reported "(unchanged)".

### Notes for the lead

- For a `progress` card message `data-bubble-look` is now `undefined` (like `bigEmoji`), since there is no bubble. No test or CSS references that case.
- In a group chat the sender name still shows above the card (`showSender` logic is unchanged), as the spec asked; the avatar column is untouched.
- This is a UI change with no automated coverage. I did not open a browser; a real progress card still needs the lead's live check.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead read:**
  - `hidesBodyText` now covers `progress`, so the fallback text is gone;
  - a progress message skips the bubble surface, as `bigEmoji` does;
  - the card loses the `px-3 py-1.5` box;
  - there is no `MessageMeta` row (time or "edited") for a progress card; approval and question cards are unchanged.
- **After deploy, the lead checks a real work card** in "ai test › General" in a browser. T-1619 is the phone twin.
