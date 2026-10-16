---
id: T-1723
title: "Routine approval card as drawn (approved board WebRoutineAsk/PhoneRoutineAsk): when the request is routine.schedule, the card title row shows a repeat icon, the routine title, and the schedule in mono on the right (split from the summary 'Title · schedule' at its last ' · '), in both the pending and the decided one-line state, web and phone"
status: merged
milestone: M5
branch: task/T-1723-routine-approval-card
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1723: The routine approval card as drawn

## Spec (written by Claude, do not edit)

### Why
Julio approved the routine boards on 2026-10-16. The "routine asks" board (`docs/design/mockups/routines/WebRoutineAsk.dc.html`, `PhoneRoutineAsk.dc.html`) draws the routine's approval card with a repeat icon, the title "Prices" and the schedule "every 5 min" in mono on the right. The "live" board's allowed card is one line: a check, the title, and the schedule on the right.

Since T-1716 the server sends a `routine.schedule` card's summary as `<title> · <schedule>`, for example `Prices · every 5 minutes` (`apps/server/src/tools/routine-adapters.ts:104`). Read the boards first (`git show main:docs/design/mockups/routines/WebRoutineAsk.dc.html`).

### Facts (the lead read them on 2026-10-16)
- **Web `apps/web/src/components/ApprovalCard.tsx`** (254 lines):
  - the decided state is one line, `<DecidedIcon …/>` plus `{request.summary}` muted (`:87-93`);
  - the pending state shows the "X asks" label and `{request.summary}` in 16 px semibold (`:98-106`), and the not-decidable title row is at `:107-118`;
  - `request.action` holds the action name (`:149`).
- **Phone `apps/mobile/src/components/chat/approval-card.tsx`** (206 lines):
  - the decided line is at `:106-114` (`DecidedIcon` plus `data.summary`);
  - the pending label and summary are at `:116-121`;
  - `data.action` holds the action name.

### Steps
1. **A shared pure helper `routineCardTitle(action, summary)`** in `packages/chat-core/src/approval-title.ts`, exported from the chat-core index:
   - for `action === 'routine.schedule'` and a summary containing `' · '`, it returns `{ title, schedule }`, split at the **last** `' · '`;
   - otherwise it returns null.
2. **Web `ApprovalCard.tsx`:** when the helper returns a value, draw the title as: a lucide `Repeat` icon (15 px, muted), the title (same text style as today), and the schedule in `font-mono text-[12px] text-muted-foreground` pushed to the right.
   - Apply it in both the pending title and the decided one-line state; in the decided line the icon stays `DecidedIcon`, with the schedule on the right.
   - Other actions don't change.
3. **Phone `approval-card.tsx`:** the same rule, with the RN `Repeat` icon from the lucide package the phone already uses.
4. **No UI tests.** One tiny test for the helper in `packages/chat-core/src/approval-title.test.ts`:
   - a split with a title containing " · ";
   - a non-routine action returns null.

### Allowed files
- `packages/chat-core/src/approval-title.ts`
- `packages/chat-core/src/approval-title.test.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/ApprovalCard.tsx`
- `apps/mobile/src/components/chat/approval-card.tsx`
- `work/T-1723-routine-approval-card.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/approval-title.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A `routine.schedule` card** reads as on the board: the repeat icon, the title and the mono schedule, in both the pending and the decided state, on web and phone.
- **Other approval cards** don't change.

---

## Report (written by the worker when done)

### What I did

- Added the shared pure helper `routineCardTitle(action, summary)` in
  `packages/chat-core/src/approval-title.ts` and exported it from
  `packages/chat-core/src/index.ts`. For `action === 'routine.schedule'` and a
  summary containing `' · '` it splits at the **last** `' · '` into
  `{ title, schedule }`; otherwise it returns `null`.
- Web `apps/web/src/components/ApprovalCard.tsx`: when the helper returns a
  value, the pending title row draws a lucide `Repeat` (15 px, muted), the title
  in the existing 16 px semibold style, and the schedule in
  `font-mono text-[12px] text-muted-foreground` pushed right. The decided
  one-line state keeps `DecidedIcon` and adds the title (14 px muted, growing)
  plus the mono schedule on the right. Other actions are byte-identical.
- Phone `apps/mobile/src/components/chat/approval-card.tsx`: the same rule, with
  the RN `Repeat` from `lucide-react-native` (`size={15}`,
  `color={MUTED_FOREGROUND}`); the decided line keeps `DecidedIcon` and adds the
  mono schedule on the right.
- Test `packages/chat-core/src/approval-title.test.ts`: one split case (title
  containing `' · '`, split at the last separator) and the non-routine
  `null` case.

Files changed: `packages/chat-core/src/approval-title.ts` (new),
`packages/chat-core/src/approval-title.test.ts` (new),
`packages/chat-core/src/index.ts`, `apps/web/src/components/ApprovalCard.tsx`,
`apps/mobile/src/components/chat/approval-card.tsx`,
`work/T-1723-routine-approval-card.md`.

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/approval-title.test.ts`
  → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm gate` (first run) → **GATE FAIL** on `format`:
  `[warn] apps/mobile/src/components/chat/approval-card.tsx`. Fixed with
  `pnpm exec prettier --write apps/mobile/src/components/chat/approval-card.tsx`.
- `pnpm gate` (second run) → **GATE PASS**. Summary lines:

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (2.2s)
  PASS  lint  (1.5s)
  PASS  typecheck  (11.0s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/chat-core  (2.4s)
  PASS  tests @zilar/mobile  (2.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The helper splits on the literal `' · '` (space, middle dot, space), matching
  the join in `apps/server/src/tools/routine-adapters.ts` (`${title} · ${schedule}`).
  A routine summary without that separator returns `null`, so the card falls back
  to the plain one-line summary and nothing crashes.
- Scope note / open question: on web the task named only "the pending title and
  the decided one-line state". The web `else` title row (used for
  loading/error/not-decidable, `ApprovalCard.tsx:107-118`) still draws the raw
  `Prices · every 5 min` summary. On phone there is a single title block for all
  non-decided states, so it naturally shows the split in not-decidable too. If
  you want the web not-decidable row to match, say so and I'll extend it. I left
  it out to stay exactly within the spec.
- No dependencies added: `Repeat` is already used on phone
  (`apps/mobile/src/components/stickers/pack-grid.tsx`) and comes from the
  `lucide-react` / `lucide-react-native` packages already imported by both cards.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits, accepted. One is a degenerate empty split, which the server never sends: the routine title is required, and the schedule always describes.
- **The change:**
  - `routineCardTitle` splits a `routine.schedule` summary at its last " · ";
  - on web and phone, the pending card shows the repeat icon, the title and the mono schedule;
  - the decided line keeps its status icon, with the schedule on the right;
  - other actions don't change.
- **Context:** this matches the approved "routine asks" and "live" boards.
