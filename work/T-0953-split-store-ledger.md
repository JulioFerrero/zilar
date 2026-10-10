---
id: T-0953
title: "Size split T11+T12: packages/client-core/src/store/ledger.ts (1,176 lines) into ledger-{types,signatures,ids,edits,mutators,identity,reactions,incoming}.ts, the old path a barrel"
status: todo
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

## Review (written by Claude)
