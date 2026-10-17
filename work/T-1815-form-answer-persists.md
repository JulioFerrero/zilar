---
id: T-1815
title: "A sent form keeps its answer: the protocol gains form.sent {by?, at}, the server merge copies the latest answer into the fields' values and sets sent, and web and phone draw a sent form read-only with an answered row; an empty number field shows 0"
status: merged
milestone: M5
branch: task/T-1815-form-answer-persists
model: auto
effort: default
depends_on: [T-1813]
estimate: 40 min
---

# T-1815: The form answer persists

## Spec (written by Claude, do not edit)

### Why
**Live on 2026-10-17** (web, "cards test", build `af0cf1b2e`):
- a quick form ("Book Dinner Table": Day, Time, People) sent fine; the reply "@Deepseek Day: 2026-10-18, Time: 21:00, People: 2" reached the AI;
- but when the room correction arrived, the card **reset to empty fields with an active Send key**, so it looks unsent and invites a second send;
- the empty People stepper also showed **no number** between − and +.

The cause is the same as for buttons (T-1813): the form has no answered field, the server merge doesn't handle forms, and the clients keep the sent state only locally. No board draws a sent form. Use the buttons' answered row from the boards (`docs/design/mockups/blocks/WebChoices.dc.html:63`, `PhoneChoices.dc.html:62`: a green check, the text and the time) as the pattern.

### Facts (read by the lead on 2026-10-17)
- **Protocol:** `packages/protocol/src/blocks-choices.ts:101-124`: `FormBlockSchema = struct({ kind: 'form', id, title?, fields[1-4]{ id, label, kind: text|number|date, value?: NumberText }, submit })`. T-1813 (merged) added `buttons.chosen` with `IsoDateTimeSchema` in the same file; follow its style.
- **Server:**
  - `apps/server/src/message-blocks/respond.ts:151-163` records `{ kind: 'item', itemId: '', value: { fields } }`, a field id → text map, after checking ids and lengths;
  - the merge is `apps/server/src/message-blocks/apply.ts` (`applyBlock` at `:141`; T-1813's `applyButtons` is the pattern), tested in `apps/server/src/message-blocks/cards.test.ts`.
- **The guide:** `apps/server/src/message-blocks/guide.ts:115`: "Never send `votes`, `selected` or `chosen`; the server fills them in."
- **Web:** `apps/web/src/components/message/blocks/FormBlock.tsx` (167 lines):
  - initial values `field.value ?? ''` (`:29`);
  - the number stepper (`:85-90`) shows the raw value, so `''` shows nothing.
- **Phone:** `apps/mobile/src/components/chat/blocks/form-block.tsx` (167 lines), the same structure.

### Steps
1. **Protocol:** add `sent: Schema.optional(struct({ by: Schema.optional(Text), at: IsoDateTimeSchema }))` to `FormBlockSchema`.
2. **Server `apply.ts`, `applyForm(block, rows, nameOf)`:** take the latest row's `fields` map. Copy each known field's text into that field's `value`, trimmed to fit `NumberText`, and drop any value that doesn't fit. Set `sent: { at: row.updatedAt.toISOString(), by?: nameOf(row.actorId) }`. Wire it into `applyBlock`.
3. **One test in `cards.test.ts`:** a form plus one answer gives the values and `sent`, and the result decodes as `BlocksDataSchema`.
4. **Guide:** add `sent` to the "Never send …" rule.
5. **Web and phone form renderers:**
   - with `block.sent` set (or right after a successful local send), the fields are read-only with their values;
   - the Send key is replaced by the answered row: a green check, "You sent this" for a local send, otherwise "{by} sent this" ("Sent" when `by` is missing), plus the time from `sent.at`;
   - an empty number field starts at and shows `0`;
   - the prop-change reset picks up `sent` and the values.
6. Keep every file at most 400 lines. **No UI tests.**

### Allowed files
- `packages/protocol/src/blocks-choices.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/message-blocks/cards.test.ts`
- `apps/server/src/message-blocks/guide.ts`
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `work/T-1815-form-answer-persists.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/cards.test.ts src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- After a send and a reload, the form shows its sent values read-only with the answered row, on web and phone.
- An empty number field shows 0.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- `packages/protocol/src/blocks-choices.ts`: added the optional `sent: { by?, at }` to `FormBlockSchema`, with `Text` and `IsoDateTimeSchema` like `buttons.chosen`.
- `apps/server/src/message-blocks/apply.ts`: added `applyForm(block, rows, nameOf)` and wired it into `applyBlock`. It reads the latest row's `fields` map, copies each known field's trimmed text into that field's `value` (a value over `NumberText`'s 40 chars is cut to 39 characters plus `…`), and sets `sent: { at: row.updatedAt.toISOString(), by? }`.
- `apps/server/src/message-blocks/guide.ts`: `sent` joins `votes`, `selected` and `chosen` in the "never send" rule (and the comment above it).
- `apps/server/src/message-blocks/cards.test.ts`: one test, a form with one answer → values `['2026-10-18', '21:00 and a note that runs well past th…', '2']`, with the 60-character time answer truncated to 40 characters (39 plus `…`), `sent.by === 'Ana'`, a parsable `sent.at`, and the result still decodes as `BlocksDataSchema`.
- `apps/web/src/components/message/blocks/FormBlock.tsx`: `sent` (or a successful local send) makes the fields read-only and replaces the Send key with the answered row — green check, "You sent this" / "{by} sent this" / "Sent", and `formatTime(sent.at)`. The prop sync picks up `sent` and the merged values, and a local send keeps the "You" wording. An empty number field starts at 0. The component stays at 213 lines.
- `apps/mobile/src/components/chat/blocks/form-block.tsx`: the same behaviour in the phone renderer, using `onSettled(ok)` for the local "You sent this" and the shared `clockTime` pattern from `buttons-block.tsx`. 220 lines.

### Checks run

- `pnpm install`: done in 15.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/cards.test.ts src/message-blocks/guide.test.ts`: 7 passed (7), 0 failed.
- Fix round, `cd apps/server && pnpm exec vitest run src/message-blocks/cards.test.ts --reporter=dot`: 1 file passed, 4 tests passed, 0 failed.
- `pnpm gate`: `GATE PASS` after one Prettier fix in `apply.ts`.
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.6s)
  PASS  lint  (1.4s)
  PASS  typecheck  (9.7s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/mobile (no nearby test files)
  PASS  tests @zilar/protocol  (1.7s)
  PASS  tests @zilar/server  (8.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Spec wording "trimmed to fit `NumberText`, and drop any value that doesn't fit": after the lead's fix round a long answer is no longer dropped — it is trimmed and truncated to 39 characters plus `…`, so a 41–120 character answer still shows after a reload. The test asserts the truncated text and that the merged card still decodes.
- No UI tests were added, per the spec. Web and phone were not run live; the gate's typecheck and lint cover the renderers. Neither form renderer was exercised in a browser or simulator in this task.
- Nothing else changed; no file outside the Allowed files and no dependency added.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `45ef4b341`, after one lead round.
- **Protocol:** `form.sent { by?, at }`.
- **`applyForm`** copies the latest answer into the field values and sets `sent`. A long answer is truncated to `MAX_SHORT - 1` plus `…` (the lead's round), and the test covers it.
- **The guide** adds `sent`.
- **Web and phone** draw a sent form read-only with "You sent this" or "{by} sent this" plus the time, and an empty number field shows 0.
- **Live check after the deploy:** a new form in "cards test", send it, reload.
