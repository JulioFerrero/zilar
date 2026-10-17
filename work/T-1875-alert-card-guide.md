---
id: T-1875
title: "Alert card guide (alert plan A7 + link plan task 4): teach the `alert` kind in the interactive card guide — its shape, and the order 'post the alert card, then routine.schedule with alert_card {card, block}', one alert block per card"
status: merged
milestone: M5
branch: task/T-1875-alert-card-guide
model: auto
effort: default
depends_on: [T-1871]
estimate: 20 min
---

# T-1875: Teach the alert card (guide)

## Spec (written by Claude, do not edit)

### Why
**Every piece of the alert card is built:**
- the answer and its effect (T-1846, T-1856);
- manager-only answers (T-1860);
- the web and phone renderers;
- the card id in the `post_blocks` result (T-1869);
- the link written on create (T-1870);
- `routine.schedule`'s `alert_card` (T-1871).

**The AI isn't told any of it yet:** `alert` is missing from the interactive guide (`apps/server/src/message-blocks/guide.ts:35-41`, `:112-127`). This task covers `docs/plan/alert-card.md` task 7 and `docs/plan/alert-card-link.md` §6 task 4.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/message-blocks/guide.ts`** (135 lines):
  - `INTERACTIVE_KINDS` (`:35-41`) lists `buttons`, `poll`, `choice`, `form` and `rating`;
  - `INTERACTIVE_RULES` (`:112-119`) and `INTERACTIVE_SHAPES` (`:121-127`) are joined line lists;
  - `cardGuide({ interactive: true })` is what the `post_blocks` description carries (`apps/server/src/agents/tools/blocks-tool.ts`).
- **The alert block shape** (`packages/protocol/src/blocks-choices.ts:147-158`): `{ kind: 'alert', id, title, field: { label, value }, on: boolean, note? }`.
- **`apps/server/src/message-blocks/guide.test.ts:40-48`** asserts every interactive kind has a shape line, is in the `post_blocks` description and isn't in `CARD_KINDS`.

### Steps
1. **Add `'alert'`** to `INTERACTIVE_KINDS`.
2. **`INTERACTIVE_SHAPES`:** add `kind=alert {id,title,field:{label,value},on:boolean,note?}`.
3. **`INTERACTIVE_RULES`:** add these lines (keep them short):
   - "For a 'tell me when …' request, post an `alert` card: `title` names the rule, `field.label` names what is watched, `field.value` is the threshold as a display string, and `on: true`. Use one alert block per card."
   - "Then call `routine.schedule` in the saved-tool form (a saved tool whose result carries the watched number) with `alert_card: {card: <the card id from the post_blocks result>, block: <the alert block id>}` and `input: {threshold: <the number>}`. After approval, the switch and the threshold on the card drive that routine." (The tool form comes first per `docs/plan/alert-card.md:174-197`; prompt-form alerts are a later follow-up.)
   - "Only the routine's manager can change a linked alert. An answer given before the approval is not applied."
4. **No new test.** The existing `guide.test.ts:40-48` loop covers the new kind; run it.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `work/T-1875-alert-card-guide.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The `post_blocks` description** teaches the `alert` shape and the post-then-schedule order.
- **The saved-tool guide** doesn't mention it.
- The guide test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- Added `'alert'` to `INTERACTIVE_KINDS` in `apps/server/src/message-blocks/guide.ts`.
- Added the alert shape line `kind=alert {id,title,field:{label,value},on:boolean,note?}` to `INTERACTIVE_SHAPES`.
- Added three rules to `INTERACTIVE_RULES`: the "tell me when …" alert card fields, the post-then-`routine.schedule` order (saved-tool form, `alert_card: {card, block}`, `input: {threshold}`), and the manager-only/after-approval note.
- No test changes: the existing `guide.test.ts:40-51` loop already covers every interactive kind.

### Checks run

- `pnpm install` — completed with no output (`--silent`), exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/guide.test.ts` — 1 file passed, 3 tests passed (4.37s).
- `pnpm gate` — ended with:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.7s)
PASS  lint  (1.2s)
PASS  typecheck  (1.4s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (5.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The `post_blocks` description now teaches the alert shape and the post-then-schedule order; the saved-tool guide (`TOOL_GUIDE`) still has neither, as `guide.test.ts` asserts.
- The guide teaches only the saved-tool form; `routine.schedule`'s prompt form still accepts `alert_card` in the schema, but the guide does not mention it, per the spec.
- Nothing outside the Allowed files changed.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `f82c0d269`.
- **The guide changes:** `alert` is in `INTERACTIVE_KINDS`, with its shape line and the three rule lines word for word as specced:
  1. post the card;
  2. `routine.schedule` in the tool form with `alert_card` and `input.threshold`;
  3. manager-only answers, and nothing applied before approval.
- **The guide test loop** covers the new kind.
- **With T-1869–T-1871 and T-1878,** an AI can now set up the whole alert. The live test is pending, as is the card note (link plan task 6).
