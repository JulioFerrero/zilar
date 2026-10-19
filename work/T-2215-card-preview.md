---
id: T-2215
title: "Chat-list preview of an AI task card shows its summary, title or stage instead of 'Attachment' (shared chat-core, so web and phone both get it)"
status: merged
milestone: M5
branch: task/T-2215-card-preview
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2215: Task card preview text

## Spec (written by Claude, do not edit)

### Why
The lead's live check on 2026-10-19: after a reload, the "ai test › General" preview read "Deepseek: Attachment" for a stopped AI task card. Live, the same card read "Deepseek: Stopped after 10s". A card message loaded from history carries no body text, so the preview falls back to 'Attachment'.

### Facts (the lead read these on 2026-10-19)
1. `packages/chat-core/src/messages.ts:170-195` `previewBody`: when there is no text and `lastMessage.card !== undefined`, it returns `'Attachment'` (`:192-193`).
2. `card` is the message `Payload` (`packages/chat-core/src/types.ts:70`). A task card is `{ v: 0, type: 'progress', data: Progress }` (`packages/protocol/src/payload.ts:37`).
3. `Progress` (`packages/protocol/src/progress.ts:13-33`) has `stage` (always set), `title?`, `summary?` and `state?`.

### Steps
1. In `previewBody`, for `card.type === 'progress'` return:
   - `data.summary` when the card is closed and has one;
   - else `data.title`;
   - else `data.stage`.

   Other card types keep `'Attachment'`.
2. Add one expectation to the existing `previewBody and previewPrefix` block in `packages/chat-core/src/messages.test.ts:165`: a stopped progress card with `summary: 'Stopped after 10s'` previews as that text.
3. No other file. Web and phone both read `previewBody`.

### Allowed files
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/messages.test.ts`
- `work/T-2215-card-preview.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/messages.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Lead live check after the deploy: reload chat.zilar.app; the "ai test › General" preview shows the card's summary or title, not "Attachment".

---

## Report (written by the worker when done)

### What I did
`previewBody` now previews a `progress` card with its text instead of 'Attachment':
when the card is closed (state is not `working` and not undefined) and it has a
`summary`, it returns the summary; otherwise it returns `title`, falling back to
`stage`. Other card types still return 'Attachment'. The check reuses the existing
`isLive` helper from `block-progress.ts`, so "closed" matches how the cards render.

Added one test in the `previewBody and previewPrefix` block: a stopped progress card
with `summary: 'Stopped after 10s'` previews as that text.

### Files changed
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/messages.test.ts`
- `work/T-2215-card-preview.md`

### Commands and results
- `pnpm install`: done, no errors (one existing peer-dependency warning in `apps/mobile`).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts`:
  1 test file passed, 24 tests passed.
- `pnpm gate`: `GATE PASS`. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/chat-core  (0.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: packages/chat-core/src/messages.ts: 401 lines (main 393); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Problems
None. Gate reports a soft size warning: `messages.ts` is 401 lines (8 lines added).
The gate treats it as a warning, not a failure, and splitting the file is not warranted.

### Deviations from the spec
None.

### Open questions
None.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings).

`previewBody` now shows a progress card as:
- its summary, when the card is closed (`isLive` from `block-progress`);
- else its title;
- else its stage.

Other card types keep "Attachment". There is one new expectation in the existing preview test. Web and phone both read this shared function.

The live check (the topic preview after a reload) follows the deploy.
