---
id: T-1869
title: "Alert link task 1: post_blocks tells the AI the posted card's id ('Your card was posted in this room (card id <id>). …') so it can pass it to routine.schedule; the DM wording gets the same id; post-blocks tests updated"
status: merged
milestone: M5
branch: task/T-1869-post-blocks-card-id
model: auto
effort: default
depends_on: [T-1864]
estimate: 20 min
---

# T-1869: `post_blocks` returns the card id (alert link plan, task 1)

## Spec (written by Claude, do not edit)

### Why
**This is task 1 of `docs/plan/alert-card-link.md` §6,** option (a), accepted by the lead. The AI posts an alert card first, then schedules the routine naming the card. Today the AI never learns the card's id (`docs/plan/alert-card-link.md` §2).

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/agents/gateway/post-blocks.ts`** (150 lines):
  - `POSTED_TEXT_GROUP` (`:36-37`) and `POSTED_TEXT_CHAT` (`:38-39`) are fixed sentences;
  - the success return is at `:136-140`, `content: kind === 'chat' ? POSTED_TEXT_CHAT : POSTED_TEXT_GROUP`;
  - `posted.id` is the sent message id, recorded as the card's `origin_id` by `recordPosted` (`:134`).
- **`apps/server/src/agents/gateway/post-blocks.test.ts`** asserts the exact sentences at `:79`, `:142`, `:174`, `:216` and `:249`.
- **`apps/server/src/agents/tools/blocks-tool.ts:11-15`** is the tool description.

### Steps
1. **In `post-blocks.ts`,** build the success text with the id: `Your card was posted in this room (card id ${posted.id}). Do not repeat what it shows; reply with at most one short line.`, and the same with "this chat" for a DM. Keep both sentences in one small helper.
2. **Update the five assertions** in `post-blocks.test.ts` to the new text, using the id each test's fake `send` returns. Don't add new tests.
3. **`blocks-tool.ts`:** add one sentence to the description: "The result gives the card id; pass it to `routine.schedule` as `alert_card` when the card's alert drives a routine." (`alert_card` lands in the next task.)

### Allowed files
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `work/T-1869-post-blocks-card-id.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A posted card's tool result** names its card id, in a group and in a DM.
- **Failures are unchanged:** `invalid: …` and the failed text are the same.
- The tests pass, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/agents/gateway/post-blocks.ts`: replaced the two fixed
  `POSTED_TEXT_GROUP` / `POSTED_TEXT_CHAT` constants with one small helper,
  `postedText(id, where)`, which returns
  `Your card was posted in <this room|this chat> (card id <id>). Do not repeat what it shows; reply with at most one short line.`
  The success return now passes `posted.id` and the same room/chat choice.
  The `invalid: …` and `error: the card could not be posted` paths are untouched.
- `apps/server/src/agents/gateway/post-blocks.test.ts`: updated the five exact
  sentence assertions (lines 79, 142, 174, 216, 249) to include `(card id block-1)`,
  the id each test's fake `send` returns. No new tests.
- `apps/server/src/agents/tools/blocks-tool.ts`: added the sentence "The result
  gives the card id; pass it to `routine.schedule` as `alert_card` when the card's
  alert drives a routine." to the tool description.

Files changed: `post-blocks.ts`, `post-blocks.test.ts`, `blocks-tool.ts`, this task file.

### Checks run
- `pnpm install` — Done in 29.4s, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/post-blocks.test.ts`
  — `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm gate` — summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/server  (5.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No deviations from the spec. `alert_card` is only mentioned in the tool
  description here; the actual parameter lands in the next task, as the spec says.
- No out-of-scope files were touched; the gate's scope check agrees.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `53702a788`.
- **The change:** one `postedText(id, where)` helper builds both the room and the chat results with `(card id <id>)`. The five assertions are updated, and the failure texts are unchanged.
- **Known gap until task 2 (T-1871) lands:** the tool description already mentions `routine.schedule`'s `alert_card`. A model that passes it before then gets the strict-args refusal and retries without it.
