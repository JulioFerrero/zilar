---
id: T-1810
title: "Fix: a correction carrying a blocks payload replaces its target's card in the client ledger (today only progress does), so answered interactive cards show their votes and choices after a reload and for every other viewer"
status: merged
milestone: M5
branch: task/T-1810-blocks-correction-applies
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1810: Block card corrections reach the ledger

## Spec (written by Claude, do not edit)

### Why
**Live test on 2026-10-17** (web, topic "cards test", build `8cf019db0`):
- A poll vote, a buttons answer and a star rating all worked at once: `POST /api/blocks/respond` returned 200 and the card updated from the route's data.
- After a page reload, every card was back to its original state: 0 votes and open buttons.
- The server logged no "Card correction not sent" or "Card correction failed" (`apps/server/src/message-blocks/respond.ts:210-237`), so the room correction was sent.

The cause is in the shared client ledger. Web and phone both use it.

### Facts (read by the lead on 2026-10-17)
- **`packages/client-core/src/store/ledger-edits.ts:69-83`, `cardEditFor`:** "A correction carrying a progress payload replaces its target's task card (T-1419)… Any other payload type is not a card edit and is ignored". The check is `payload.type !== 'progress'` → `undefined`.
- **The rest of the path is generic:**
  - `rememberCard` (`:85-100`) keys the update by `aliasRoot(targetId)`, checks the author and keeps the newest order;
  - `ingestEdit` (`:121-140`) calls it;
  - `cardFor` (`:180-190`) returns the stored payload for a message.
- **The server's correction:**
  - `respond.ts:221-227` sends `{ originalId: card.originId, text: data.fallback, payload: { v: 0, type: 'blocks', data } }` through `correctInRoom`;
  - after T-1791's re-key, `card.originId` is the room's archive stanza id (`apps/server/src/agents/gateway/card-rekey.ts:1-8`), which is the id the clients store the message under.
- **The existing tests** are in `packages/client-core/src/store/ledger.test.ts`, "the message ledger: payload cards" (`:465`), including the T-1419 progress-correction case (`:483`).
- **On both clients, the card renderers** reset their local state to the prop when the prop changes (web `BlockCard.tsx`, phone `block-card.tsx`), so once the ledger hands them the corrected payload, they show it.

### Steps
1. **In `cardEditFor`, accept `blocks` as well as `progress`:** `payload.type !== 'progress' && payload.type !== 'blocks'` → `undefined`. Update the comment, citing T-1810 (block card answers).
2. **Tests** (message pipeline), next to the T-1419 case in `ledger.test.ts`:
   - **(a)** A `blocks` message is received under id `S1`. Then a correction from the same author, whose `replace` target is `S1`, carries a new `blocks` payload (a poll with one vote). The bubble's `card` equals the new payload.
   - **(b)** The same correction from a different author is ignored.
   - **(c)** Read back from history (`ingestHistoryEdits`), the correction also applies, so a reload shows the answer.
3. Keep every source file at most 400 lines. `ledger-edits.ts` is 398 lines now, so keep the change to the condition and the comment (at most 2 lines net).

### Allowed files
- `packages/client-core/src/store/ledger-edits.ts`
- `packages/client-core/src/store/ledger.test.ts`
- `work/T-1810-blocks-correction-applies.md`

### Checks
```bash
cd packages/client-core && pnpm exec vitest run src/store/ledger.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A blocks correction from the card's author replaces the card, both live and from history. Another author's correction doesn't.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did
- `packages/client-core/src/store/ledger-edits.ts`: `cardEditFor` now accepts a `blocks` payload as a card edit next to `progress`, so a correction carrying a blocks payload replaces its target's card. The comment cites T-1810. Net +1 line (398 → 399), used to add the `blocks` check on its own `isCard` line so the existing narrowing stays intact.
- `packages/client-core/src/store/ledger.test.ts`: three tests in "the message ledger: payload cards", after the T-1419 case:
  - (a) a `blocks` card under id `S1` is replaced by a correction from the same author carrying a poll with one vote;
  - (b) the same correction from another author is ignored;
  - (c) the correction read back through `ingestHistoryEdits` also replaces the card (reload case).

### Checks run
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`: 1 file passed, 26 tests passed.
- `pnpm gate`: `gate: 3 changed file(s) against main`; PASS install (frozen), format, lint, typecheck, effect, tests @zilar/client-core; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `images: every workspace package an app image needs is copied into its Dockerfile`; `size: every changed source file is within 400 lines`; `GATE PASS`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `9dbc64938`.
- **`cardEditFor`** accepts `blocks` as well as `progress`; the rest of the path (author check, newest order, alias root) is unchanged.
- **Three tests** would each fail on the old code: live, other author, and from history.
- **The correction's `replace` id** is the card's re-keyed id, the same id the client sent to the respond route, so it lands on the stored message.
- **Live check after the deploy:** answer a card in "cards test", reload, and the answer stays.

### Notes for the lead
- No deviations from the spec. No files touched outside the Allowed files.
- The `isCard` line is `payload?.type === 'progress' || payload?.type === 'blocks'` and the guard also keeps `payload === undefined` explicit, because a plain boolean does not narrow `payload` for the returned `CardEdit`.

