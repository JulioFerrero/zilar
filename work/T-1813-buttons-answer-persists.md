---
id: T-1813
title: "A buttons card keeps its answer: the protocol gains buttons.chosen {actionId, by?, at}, the server merge fills it from the latest response, and web and phone draw the answered row from the data (not only from local state)"
status: merged
milestone: M5
branch: task/T-1813-buttons-answer-persists
model: auto
effort: default
depends_on: [T-1810]
estimate: 40 min
---

# T-1813: The buttons answer persists

## Spec (written by Claude, do not edit)

### Why
**Live on 2026-10-17** (web, "cards test", after T-1810):
- after a reload, a poll vote stays (the correction now reaches the ledger);
- but an answered buttons card ("You chose Wait until Monday") **reopens with both keys**, for the tapper and for every other member.

The cause:
- the buttons schema has no answered field;
- the server's merge doesn't handle buttons;
- web and phone hold "You chose" only in local state.

The boards draw the answered row: `docs/design/mockups/blocks/WebChoices.dc.html:63` and `PhoneChoices.dc.html:62`, "You chose **Book it**" with a green check and the time.

### Facts (read by the lead on 2026-10-17)
- **Protocol:**
  - `packages/protocol/src/blocks-choices.ts:12-37`: `ButtonsBlockSchema = struct({ kind: 'buttons', id, text, actions[1-4]{ id, label, style } })`;
  - the helpers are imported at `:1-3` (`IdSchema`, `struct`, `Text`); `IsoDateTimeSchema` is in `./common` (used in `blocks-content.ts:2`);
  - checklist items already carry `by: Schema.optional(Text)` (`blocks-progress.ts:16`).
- **Server:**
  - `apps/server/src/message-blocks/respond.ts:144-150` records a buttons answer as `{ kind: 'item', itemId: '', value: { actionId } }`;
  - `apps/server/src/message-blocks/apply.ts` (135 lines) merges checklist, poll, choice and rating in `applyBlock` (`:114-127`); there's no buttons case;
  - `latestRow` (`:36-50`) and the `nameOf` pattern from `applyChecklist` (`:70-91`) are the building blocks;
  - merge tests live in `apps/server/src/message-blocks/cards.test.ts` (`applyResponses` with a `nameOf`, `:58`).
- **The guide:** `apps/server/src/message-blocks/guide.ts:115`: "Never send `votes` or `selected`; the server fills them in."
- **Web:** `apps/web/src/components/message/blocks/ButtonsBlock.tsx` (97 lines):
  - local `answered` state (`:39`);
  - the answered row "You chose {label}" plus the time (`:63-91`).
- **Phone:** `apps/mobile/src/components/chat/blocks/buttons-block.tsx` (90 lines): local `answered` state, with the same row.

### Steps
1. **Protocol:** add `chosen: Schema.optional(struct({ actionId: IdSchema, by: Schema.optional(Text), at: IsoDateTimeSchema }))` to `ButtonsBlockSchema`. A `chosen.actionId` that names no action fails the decode (use the file's existing filter style).
2. **Server `apply.ts`:** add `applyButtons(block, rows, nameOf)`:
   - take the latest row's `actionId` (string; it must be one of the block's actions);
   - set `chosen: { actionId, at: row.updatedAt.toISOString(), by?: nameOf(row.actorId) }`;
   - wire it into `applyBlock`;
   - add one test to `cards.test.ts`: a buttons card plus one response gives `chosen` with the action, the name and the time, and the result still decodes as `BlocksDataSchema`.
3. **Guide `guide.ts:115`:** "Never send `votes`, `selected` or `chosen`; the server fills them in."
4. **Web `ButtonsBlock.tsx` and phone `buttons-block.tsx`:**
   - when `block.chosen` is set and its action exists, start in the answered state, with the label from `actions` and the time from `chosen.at`;
   - the row reads "You chose {label}" when the viewer just tapped it in this view (local state), otherwise "{by} chose {label}" ("Someone chose" when `by` is missing);
   - an answered card takes no more taps;
   - the prop-change reset (the room correction) also picks up `chosen`.
5. Keep every file at most 400 lines. **No UI tests.**

### Allowed files
- `packages/protocol/src/blocks-choices.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/message-blocks/cards.test.ts`
- `apps/server/src/message-blocks/guide.ts`
- `apps/web/src/components/message/blocks/ButtonsBlock.tsx`
- `apps/mobile/src/components/chat/blocks/buttons-block.tsx`
- `work/T-1813-buttons-answer-persists.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/cards.test.ts src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- After an answer and a reload, the buttons card shows the answered row on web and phone, for the tapper and for other members.
- The merge test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **Protocol** (`packages/protocol/src/blocks-choices.ts`): added the optional `chosen`
  struct (`actionId`, optional `by`, `at` from `IsoDateTimeSchema`) to
  `ButtonsBlockSchema`, plus a struct-level filter that rejects a `chosen.actionId`
  naming no action. Also imported `IsoDateTimeSchema` from `./common`.
- **Server** (`apps/server/src/message-blocks/apply.ts`): added `stringField` and
  `applyButtons(block, rows, nameOf)`. It takes the latest row for the block, reads
  `actionId` (ignoring a value that names no action), and sets
  `chosen: { actionId, at: row.updatedAt.toISOString(), by?: nameOf(row.actorId) }`.
  Wired into `applyBlock`. The input card is not mutated.
- **Test** (`apps/server/src/message-blocks/cards.test.ts`): a buttons card recorded
  through `recordCard`, one `upsertResponse` with `{ actionId: 'a-2' }`, then
  `listResponses` + `applyResponses`; asserts `chosen` carries the action, `by: 'Ana'`
  and a parseable `at`, and that the result still decodes as `BlocksDataSchema`.
- **Guide** (`apps/server/src/message-blocks/guide.ts`): the rule now reads
  "Never send `votes`, `selected` or `chosen`; the server fills them in." and the
  comment above `INTERACTIVE_RULES` mentions `chosen` too.
- **Web** (`apps/web/src/components/message/blocks/ButtonsBlock.tsx`): kept the
  `initialAnswer` fixture hook. State starts answered from `block.chosen` when its
  action exists (label from `actions`, time from `chosen.at`, `mine: false`), and a
  tap stores `mine: true`. The prop-sync block picks `chosen` up when it changes;
  if the local tap was on the same action it keeps the "You chose" wording. The row
  reads "You chose {label}" locally, otherwise "{by} chose {label}", or
  "Someone chose {label}" when `by` is missing. An answered card still takes no taps.
- **Phone** (`apps/mobile/src/components/chat/blocks/buttons-block.tsx`): same
  model; state starts from `block.chosen`, the prop-sync picks a correction up, the
  clock time comes from `chosen.at`, and the row uses the same three wordings.

No dependencies added. All six files stay well under 400 lines (154, 164, 171, 133,
134 and 124 lines). No UI tests were added, per the spec.

### Checks run

- `pnpm install` — done first, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/cards.test.ts`
  — 1 file passed, 3 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/guide.test.ts`
  — 1 file passed, 3 tests passed.
- Ad-hoc decode check through `pnpm exec tsx` in `packages/devtools`:
  a `chosen` naming a real action decodes; one naming `nope` is rejected.
- `pnpm gate` (from the repo root) summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.5s)
  PASS  lint  (0.6s)
  PASS  typecheck  (7.6s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  PASS  tests @zilar/protocol  (1.2s)
  PASS  tests @zilar/server  (6.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Two earlier gate runs failed only on Prettier and then on one `exactOptionalPropertyTypes`
  error in the web `Answer` type; both were fixed in the files above and the final run
  is the one pasted here.

### Notes for the lead

- Wording: when the room correction arrives after the viewer's own tap on the same
  action, the card keeps "You chose"; a correction that records a different action
  wins and reads "{by} chose" (or "Someone chose"). The row cannot know the viewer's
  id from the protocol, so that is a heuristic; say if you want the correction always
  to win.
- If a stored response names an action the card no longer has, `applyButtons` leaves
  the card open rather than producing data that fails `BlocksDataSchema`; `respond.ts`
  already rejects such taps, so this is only a guard.
- Nothing was pushed, merged or switched.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `eb07085b0`.
- **Protocol:** `buttons.chosen { actionId, by?, at }`, plus a filter that the action exists.
- **`applyButtons`** fills it from the latest row, with the name and the ISO time; the test covers it and the result decodes.
- **The guide** says not to send `chosen`.
- **Web and phone** start answered from `block.chosen` ("You chose" after a local tap, "{by} chose" otherwise) and take no more taps.
- **Old cards** keep their old corrections (no `chosen`). The live check after the deploy uses a new buttons card in "cards test".

