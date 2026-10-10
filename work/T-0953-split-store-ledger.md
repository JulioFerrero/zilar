---
id: T-0953
title: "Size split T11+T12: packages/client-core/src/store/ledger.ts (1,176 lines) into ledger-{types,signatures,ids,edits,mutators,identity,reactions,incoming}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0953-split-store-ledger
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0953: Split `ledger.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/client-core/src/store/ledger.ts` is 1,176 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T11, T12); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #8: `store/ledger-types.ts`, `ledger-signatures.ts`, `ledger-ids.ts`, `ledger-edits.ts`, `ledger-mutators.ts`, `ledger-identity.ts`, `ledger-reactions.ts`, `ledger-incoming.ts`, under `packages/client-core/src/`. `ledger.ts` becomes the barrel.

This is the message pipeline, so it is crucial code: move it unchanged, and run all three store suites below.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #8, and `packages/client-core/src/store/ledger.ts`.

### Allowed files
`packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/ledger-types.ts`, `packages/client-core/src/store/ledger-signatures.ts`, `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-edits.ts`, `packages/client-core/src/store/ledger-mutators.ts`, `packages/client-core/src/store/ledger-identity.ts`, `packages/client-core/src/store/ledger-reactions.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `work/T-0953-split-store-ledger.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot src/store/ledger.test.ts src/store/incoming.test.ts src/store/send.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `packages/client-core/src/store/ledger.ts` (1,176 lines) into the eight
modules in `docs/audit/size-plan.md` §2.1 #8, with `ledger.ts` as the barrel.
`createMessageLedger` and the five id maps stay in the barrel; every other
piece moved. Each moved module is a `createLedger*` factory that receives the
shared `get`/`set`, the maps and its siblings, and destructures them at the top
so the moved function bodies are unchanged. The factories are assembled in
`createMessageLedger`; the returned object lists the same names as before, so no
importer changed.

### Files changed (9 allowed code files + this task file)

- `store/ledger.ts` (rewritten as the barrel)
- `store/ledger-types.ts`, `store/ledger-signatures.ts`, `store/ledger-ids.ts`,
  `store/ledger-edits.ts`, `store/ledger-mutators.ts`, `store/ledger-identity.ts`,
  `store/ledger-reactions.ts`, `store/ledger-incoming.ts` (new)

### `wc -l` before and after

| file | lines |
| --- | ---: |
| old `store/ledger.ts` | 1176 |
| new `store/ledger.ts` (barrel) | 130 |
| `store/ledger-types.ts` | 77 |
| `store/ledger-signatures.ts` | 59 |
| `store/ledger-ids.ts` | 215 |
| `store/ledger-edits.ts` | 295 |
| `store/ledger-mutators.ts` | 184 |
| `store/ledger-identity.ts` | 90 |
| `store/ledger-reactions.ts` | 122 |
| `store/ledger-incoming.ts` | 168 |

Every file is ≤ 400 lines.

### Export diff (`grep -E "^export"`; old `main` vs the barrel + new files)

Old file exported, all still re-exported from `ledger.ts` with the same names
and kinds:

- types: `LedgerStanza`, `StoreMessage`, `LedgerContact`, `LedgerState`,
  `LedgerPatch`, `LedgerSet`, `MessageLedgerDeps`, `MessageLedger` (now in
  `ledger-types.ts`, re-exported by the barrel)
- values: `signatureFor`, `stickerSignatureFor`, `isReactionOnly`,
  `isEditStanza`, `listFor`, `previewFor` (now in `ledger-signatures.ts`,
  re-exported), and `createMessageLedger` (still in the barrel)

Newly exported, only so the moved pieces can call each other; none is
re-exported from the barrel:

- `ledger-types.ts`: `LedgerMaps`
- `ledger-signatures.ts`: `mentionLocalpart`, `authorOfChatMessage`
- `ledger-ids.ts`: `createLedgerIds`, `LedgerIds`
- `ledger-edits.ts`: `createLedgerEdits`, `LedgerEdits`
- `ledger-mutators.ts`: `createLedgerMutators`, `LedgerMutators`
- `ledger-identity.ts`: `createLedgerIdentity`, `LedgerIdentity`
- `ledger-reactions.ts`: `createLedgerReactions`, `LedgerReactions`
- `ledger-incoming.ts`: `createLedgerIncoming`, `LedgerIncoming`

The 15-name public surface of `ledger.ts` is unchanged.

### Commands and real results

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/incoming.test.ts src/store/send.test.ts`
  → `Test Files 3 passed (3)`, `Tests 35 passed (35)`.
- `pnpm gate` (first run) → `FAIL format` on `ledger-reactions.ts` only; fixed
  with `pnpm exec prettier --write` on the nine files.
- `pnpm gate` (final):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (1.1s)
PASS  tests @zilar/client-core  (5.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The `effect` step passed with no markers: the moved code is pure, like the
original, so no `// effect-plain:` line was needed.

### Deviations from the spec (all behaviour-preserving)

1. **Dedup, sticker/attachment functions.** The plan names `markStickerFailed`
   among the "identical list-map + lastMessage-mirror" blocks, but in the old
   file `markStickerFailed` and `markAttachmentFailed` set `messagesByChat`
   only — they never mirror to the chat-list preview. Mirroring them would be a
   behaviour change, so the six blocks that really do mirror
   (`updateMessageStatus`, `updateMessageVoice`, `updateMessageAttachment`,
   `markSendFailed`, `clearSendFailure`, `markSendRetrying`) use
   `patchMessageAndLast`, and the two list-only blocks use a second small
   `patchMessage` helper. This removes the same duplication the entry wanted,
   inside the same file module, without changing the sticker/attachment path.
   `patchMessageAndLast` decides whether to rebuild `chats` by reference, so a
   `markSendFailed` on a message that is not still `sending` leaves the preview
   untouched, exactly as before.
2. **`sanitizeIncomingVoice`.** Lines 94–111 of the old file fall in no range
   the plan lists. It only feeds `toUiMessage`, so it moved to
   `ledger-incoming.ts`.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `ledger.ts` (1,176 lines) becomes a 130-line barrel plus the 8 `ledger-*.ts` files, the largest `ledger-edits.ts` at 295.
- **Check:** the gate passed, with the ledger, incoming and send store tests (message pipeline).
