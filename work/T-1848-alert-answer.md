---
id: T-1848
title: "Alert card A1: POST /api/blocks/respond accepts an alert answer — `done` is the switch, `fields.value` the threshold (a number, 400 otherwise) — records it and merges it into the card's `on` and `field.value`"
status: merged
milestone: M5
branch: task/T-1848-alert-answer
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1848: The respond route takes an alert answer (alert plan A1)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/alert-card.md` (2026-10-17):** option B, where the alert card controls one routine. This is task 1 of §6.
- **Today an alert answer is a 400:** `recordedResponse` has no `alert` case, and `applyResponses` leaves the block as it is.
- **This task** only records and merges the answer.
- **Later tasks:**
  - T-A2 links the card to its routine;
  - T-A4 makes the alert manager-only.

  Until then any card member's answer only changes the card's drawing.

### Facts (read by the lead on 2026-10-17)
- **The alert block** (`packages/protocol/src/blocks-choices.ts:147-158`): `{ kind: 'alert', id, title, field: { label, value: NumberText }, on: boolean, note? }`.
- **The answer value** (`packages/api-contract/src/message-blocks.ts:29-36`, `BlocksRespondValue`): optional `done` (boolean), `optionIds`, `selected`, `rating`, `actionId` and `fields` (a `Record<string, string>`).
- **`apps/server/src/message-blocks/respond.ts`** (320 lines):
  - `recordedResponse(block, itemId, value)` (`:106-177`) validates per kind and returns `{ kind: 'item', itemId: '', value: {...} }` for one-answer kinds;
  - `default:` throws `invalidResponse()` (`:174-176`);
  - `FORM_VALUE_MAX = 120` (`:24`).
- **`apps/server/src/message-blocks/apply.ts`** (192 lines):
  - `latestRow(rows, blockId)` (`:44`) and `fieldOf(value, key)` (`:21`) are the helpers;
  - `applyForm` (`:142-163`) is the closest pattern;
  - `applyBlock` (`:165-184`) switches on the kind, with `default: return block`;
  - `MAX_SHORT` comes from `@zilar/protocol`.
- **Tests:** `apps/server/src/message-blocks/respond.test.ts` (215 lines) covers stranger 404s, the checklist merge, DM owner-only access and poll picks.

### Steps
1. **`recordedResponse`, `case 'alert'`:** accept `value.done` (boolean, the switch) and/or `value.fields?.value` (the threshold text); at least one must be present, else 400.
   - **The threshold** is trimmed and at most `FORM_VALUE_MAX` characters. It counts as a number when, after removing spaces, commas and one leading currency sign (`$`, `€` or `£`), `Number(...)` is finite. Anything else is a 400.
   - **Return** `{ kind: 'item', itemId: '', value: { on?: boolean, threshold?: string } }`.
2. **`apply.ts` `applyAlert`:** merge the **latest** row's `on` and `threshold` into the block, setting `on` and `field.value` (cut to `MAX_SHORT` like `applyForm`). Keep any field the row lacks. Wire it into `applyBlock`.
3. **Test** (the message pipeline): one case in `respond.test.ts`, following its existing setup. A member's alert answer `{ done: false, fields: { value: '$95,000' } }` is recorded and the corrected card has `on: false` and `field.value: '$95,000'`; `{ fields: { value: 'soon' } }` answers 400.
4. **Every file stays at most 400 lines.** If `respond.ts` would pass it, move the alert validation into a new `apps/server/src/message-blocks/alert-answer.ts`.

### Allowed files
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/message-blocks/alert-answer.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `work/T-1848-alert-answer.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **An alert answer** with a switch and/or a numeric threshold is recorded and merged into `on` and `field.value`.
- **A non-numeric threshold** or an empty answer answers 400.
- The new test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/message-blocks/respond.ts`: added `case 'alert'` to `recordedResponse`. It accepts `value.done` (boolean) and/or `value.fields.value` (threshold), requires at least one, and validates the threshold: trimmed, at most `FORM_VALUE_MAX` (120) characters, and numeric after removing spaces, commas and one leading `$`, `€` or `£` (via the new `isNumberText` and `alertAnswer` helpers). It returns `{ kind: 'item', itemId: '', value: { on?, threshold? } }`. `respond.ts` is 354 lines, so the validation stayed in the file (the `alert-answer.ts` split was not needed).
- `apps/server/src/message-blocks/apply.ts`: added `applyAlert`, wired into `applyBlock`. It merges the latest row's `on` and `threshold` into the block (`on`, and `field.value` cut to `MAX_SHORT` like `applyForm`), and keeps the current value for any field the row lacks.
- `apps/server/src/message-blocks/respond.test.ts`: added an alert card to the test setup and one test: a member's `{ done: false, fields: { value: '$95,000' } }` is stored as `{ on: false, threshold: '$95,000' }` and merged into the card (`on: false`, `field.value: '$95,000'`); `{ fields: { value: 'soon' } }` and an empty `{}` answer both return 400 and write nothing.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/respond.test.ts`: 1 file passed, 5 tests passed.
- `pnpm gate` (repo root): install, format, lint, typecheck, effect and `@zilar/server` tests all PASS; 4 changed files, all inside the Allowed files; source files within 400 lines; ended with `GATE PASS`.

### Notes for the lead
- The threshold is stored as the trimmed text the member sent (`$95,000`), not the normalised number, so the card draws the answer the way it was typed.
- A `done` that is not a boolean answers 400, matching the checklist case; the contract already restricts it.
- No files outside the Allowed files were touched.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `f6b3c0994`.
- **Read the diff in full:**
  - `alertAnswer` validates the switch and the numeric threshold, and refuses an empty answer;
  - `applyAlert` merges the latest row and cuts to `MAX_SHORT`, which is 40, the same limit as `NumberText`, so the merged card still decodes;
  - the test covers the merge, the 400 for "soon" and for `{}`, with no row written.
- **Nit accepted:** there's no single-field test.
- **Any member may answer until T-A4.**
