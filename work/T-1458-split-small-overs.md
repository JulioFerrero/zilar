---
id: T-1458
title: "400-line rule: mock-backend groups/routes.ts (437) moves its member handlers out; xmpp-core core-effect/operations.ts (401) moves the OperationsApi type out; no behaviour change"
status: merged
milestone: M5
branch: task/T-1458-split-small-overs
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1458: Two small splits

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10): at most 400 lines per source file. These two files are just over, and the gate blocks any growth of a file already above 400.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/mock-backend/src/domains/groups/routes.ts`** is 437 lines:
  - `handleGroups` (`:25`, the only export);
  - private handlers `createGroup` (`:62`), `chatEntryOf` (`:130`), `patchGroup` (`:155`), `handleReason` (`:221`), `handleMembers` (`:233`), `addMembers` (`:257`), `changeRole` (`:274`), `removeMember` (`:309`), `transferOwner` (`:338`) and `deleteGroup` (`:367`).
- **`packages/xmpp-core/src/core-effect/operations.ts`** is 401 lines: `export type OperationsApi` (`:54-100`) and `createOperations(runtime)` (`:101+`).

### What to build
1. **Mock groups:** move `handleMembers`, `addMembers`, `changeRole`, `removeMember` and `transferOwner` into a new `packages/mock-backend/src/domains/groups/members-routes.ts`. `routes.ts` imports `handleMembers` from it. Behaviour is identical.
2. **xmpp-core:** move `OperationsApi` (and any type-only helpers it needs) into a new `packages/xmpp-core/src/core-effect/operations-types.ts`. `operations.ts` re-exports the type, so every importer keeps working. **Don't change any runtime code in `operations.ts`.**
3. Both files end at 400 lines or fewer, well under ideally.

### Tests
None new. Existing mock-backend and xmpp-core tests must pass.

### Allowed files
- `packages/mock-backend/src/domains/groups/routes.ts`, `packages/mock-backend/src/domains/groups/members-routes.ts`
- `packages/xmpp-core/src/core-effect/operations.ts`, `packages/xmpp-core/src/core-effect/operations-types.ts`
- `packages/mock-backend/src/domains/groups/routes.test.ts` (added by the lead on 2026-10-15: one stale assertion, red on main since T-1355)
- `work/T-1458-split-small-overs.md`

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Both splits are done, with no behaviour change.

**Mock groups.** `packages/mock-backend/src/domains/groups/members-routes.ts` (new) holds
`handleMembers`, `addMembers`, `changeRole`, `removeMember`, `transferOwner`, their private
`memberView`, and the three small helpers they share with `routes.ts` (`personName`,
`readStringArray`, `unique`). `routes.ts` imports `handleMembers`, `transferOwner`,
`personName`, `readStringArray` and `unique` from it. The helpers live in `members-routes.ts`
rather than the other way round so there is no circular import between the two files. I also
dropped the now-unused `GroupMember` import from `routes.ts` and updated its header comment.

**xmpp-core.** `packages/xmpp-core/src/core-effect/operations-types.ts` (new) holds the
`OperationsApi` type (and the type-only imports it needs). `operations.ts` does
`import type { OperationsApi } from './operations-types'; export type { OperationsApi };`
so every importer keeps working, and `createOperations` is untouched. No runtime line in
`operations.ts` changed.

### Files changed

- `packages/mock-backend/src/domains/groups/routes.ts` — 437 → 285 lines
- `packages/mock-backend/src/domains/groups/members-routes.ts` — new, 175 lines
- `packages/xmpp-core/src/core-effect/operations.ts` — 401 → 357 lines
- `packages/xmpp-core/src/core-effect/operations-types.ts` — new, 61 lines
- `work/T-1458-split-small-overs.md`

### Commands I ran

- `pnpm install` — ok (peer warning about `@types/react-dom` vs `@types/react`, pre-existing).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/groups/routes.test.ts`
  — **1 failed | 3 passed** (`keeps the channel fields on the created channel row`).
- `pnpm --filter @zilar/xmpp-core exec vitest run --maxWorkers=2 --reporter=dot`
  — **4 files passed, 150 tests passed**.
- `pnpm gate` — **GATE FAIL**; everything passes except the one mock-backend test above
  (full summary below).

### Gate summary lines

```
PASS  install (frozen)  (1.2s)
PASS  format  (0.5s)
PASS  lint  (0.9s)
PASS  typecheck  (2.8s)
PASS  effect  (0.8s)
FAIL  tests @zilar/mock-backend  (2.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE FAIL
```

Scope is clean (no files outside the Allowed files), size passes, and format/lint/typecheck/effect
pass. The only failure is the mock-backend test named above.

### Blocked / needs a decision

The gate cannot go green because of a **pre-existing, out-of-scope test failure** that my split did
not cause:

`packages/mock-backend/src/domains/groups/routes.test.ts:50`, `group create route > keeps the
channel fields on the created channel row`, asserts `group?.topics).toHaveLength(1)` for a newly
created **channel**. But T-1355 (merged) made a channel answer `topics: []`:
`packages/mock-backend/src/domains/chats/routes.ts:117-121` (`if (entry.chatKind === 'channel')
return { ...entry, topics: [] };`), mirroring the real server. So the groups test line is stale.

Proof it is pre-existing, not mine: I ran the same test file with my changes stashed
(`git stash -u`), against the branch base — same result, 1 failed | 3 passed. My change to
`routes.ts` is a pure move of the member handlers; the failing path (`createGroup` → `chatEntryOf`
→ `addTopic`) is byte-for-byte the code from the base.

I did not edit the test: it is not in the Allowed files, and the gate's scope check would flag it.

**Question for the lead:** may I update `packages/mock-backend/src/domains/groups/routes.test.ts:50`
to the T-1355 behaviour (e.g. assert the channel row has `chatKind: 'channel'` and no listed topics),
or is that test's fix yours? Every task that touches `groups/routes.ts` will hit this until it is
fixed, so I stopped here rather than mark the task done with a red gate.

**Resolved:** the lead confirmed the test is red on main and added `routes.test.ts` to the Allowed files, so I changed `:50` to `expect(group?.topics).toHaveLength(0)` (T-1355 behaviour; `chatKind`/`subscriberCount` kept), and the gate now passes.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1. These are pure moves:
- the mock group member handlers go to `members-routes.ts`;
- `OperationsApi` goes to `operations-types.ts`, re-exported.
- The lead allowed the stale channel assertion fix in `groups/routes.test.ts`: it had been red on main since T-1355, and a channel lists no topics.
