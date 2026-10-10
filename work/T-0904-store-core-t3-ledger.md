---
id: T-0904
title: "Store core T3: the message ledger (ids, aliases, edits, reactions, mentions) in packages/client-core, the web store on it"
status: todo
milestone: M5
branch: task/T-0904-store-core-t3-ledger
model: auto
effort: default
depends_on: [T-0902]
estimate: 1 day
---

# T-0904: Store core T3, the message ledger

## Spec (written by Claude, do not edit)

### Why
This is task T3 of `docs/STORE_CORE_PLAN.md` (section 6, "T3: the message ledger in core (core + web)"). Follow it exactly. It is the largest move of the split, and its risk is medium: the ledger reads back its own writes (`refreshEdits`, `migrateReactionTargets`).

The lead re-checked the cited lines on 2026-10-10:
- the ledger block in `apps/web/src/store/realStore.ts` runs from `:182` (`messageAliases`) to about `:1203`;
- `apps/web/src/store/effects/ctx.ts` has 140 lines;
- `MobileMessage` is at `apps/mobile/src/lib/types.ts:35-38`.

This branch starts from `task/T-0902-store-core-t1-rows`. T-0903 (T2) runs in parallel and edits `apps/web/src/store/effects/runtime.ts` and its own section of the core index.

### What to build
1. **Core:**
   - new `packages/client-core/src/store/ledger.ts` with `createMessageLedger({ get, set, contacts, memberName, occupantNick, mediaToken })`, over the `LedgerState` and `StoreMessage` types the plan defines;
   - new `packages/client-core/src/store/ledger.test.ts`;
   - one line in the T3 section of `packages/client-core/src/store/index.ts`.
   - `packages/chat-core/src/store/ledger.ts` (T-0877) stays where it is; the core ledger uses it.
2. **Web:** `apps/web/src/store/realStore.ts` replaces the ledger block with the core ledger. In `apps/web/src/store/effects/ctx.ts`, `Kernel` becomes the ledger type plus the few helpers left. The facades and every export of `realStore.ts` stay.
3. **Behaviour:** only R5 (mobile's `linkLocalToServer`) lands, with a new core test. Nothing else changes on web.
4. **Tests first** for any ledger path the plan marks as uncovered. Section 7 lists:
   - an echo before the send resolves;
   - two identical texts in a row;
   - the echo of a reply.

   Add them as new core tests on the ledger, and commit them before the move, run against the web code through the facade.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0904/`), `docs/STORE_CORE_PLAN.md` sections 2, 4, 6 and 7, `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/ctx.ts`, and `packages/chat-core/src/store/ledger.ts`.

### Allowed files
`packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/ledger.test.ts`, `packages/client-core/src/store/*.test.ts` (new test files only), `packages/client-core/src/store/index.ts` (T3 section only), `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/*.ts` (only the import of moved helpers), `work/T-0904-store-core-t3-ledger.md`.

T-0902's files are carried by the base branch: `packages/client-core/package.json`, `packages/client-core/src/store/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/constants.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/polling.ts`, `work/T-0900-deps-catalog.md` and `work/T-0902-store-core-t1-rows.md`.

Do not touch `apps/web/src/store/effects/runtime.ts`: T-0903 changes it.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run `src/store/realStore.test.tsx`, `realStore.forward.test.tsx` and `realStore.topics.test.tsx` 3 times.

### Acceptance
- The Checks pass, and no existing test is edited.
- The tests-first commits come before the move.
- The Report gives the lines per side and lists every behaviour difference (R5 only).
- Live check for Julio: edits, reactions, mentions, forwards and send failures on web.

---

## Report (written by the worker when done)

## Review (written by Claude)
