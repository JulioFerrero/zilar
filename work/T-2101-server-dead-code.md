---
id: T-2101
title: "Server dead code: delete public-compat.ts (its flag is always true — new public topics start empty, Julio 10-16), connections/smoke-client.ts, and five functions nothing calls (cancelDelegation, anchorParts, findAiForGateway, isAnimatedImage, effectMountsOf) — no behaviour change"
status: merged
milestone: M5
branch: task/T-2101-server-dead-code
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2101: Server dead code

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. The lead checked every item below with `git grep -lw <name> -- apps packages`: nothing outside its own file uses it, or, for `public-compat`, its flag is a constant.

### Facts (read by the lead on 2026-10-18 at `e42276bc7`)
1. **`apps/server/src/topics/public-compat.ts` (63 lines).** `PUBLIC_TOPICS_START_EMPTY = true`, and it is never changed. As a result:
   - `addToPublicTopics(...)` returns at once. It is called from `apps/server/src/groups/join.ts:152` and `apps/server/src/groups/members.ts:132`.
   - `initialPublicMemberIds(...)` always returns `[creatorId]`. It is called from `apps/server/src/topics/service.ts:110`.
   - Julio decided on 2026-10-16 that new public topics start empty. `apps/server/src/topics/public-members.test.ts` tests this file.
2. **`apps/server/src/connections/smoke-client.ts` (28 lines).** Nothing imports it, and no script names it.
3. **Five functions defined and used only in their own file:**
   - `cancelDelegation` in `apps/server/src/agents/delegation/service.ts`
   - `anchorParts` in `apps/server/src/web-tools/html.ts`
   - `findAiForGateway` in `apps/server/src/ais/queries.ts`
   - `isAnimatedImage` in `apps/server/src/stickers/image.ts`
   - `effectMountsOf` in `apps/server/src/app.ts`

### Steps
1. **`public-compat`.** Delete the file.
   - Delete the two `addToPublicTopics` calls and their imports.
   - In `topics/service.ts:110`, use `[input.actorId]` directly where `initialPublicMemberIds` was called. Keep the surrounding branch as it is.
   - Delete the test cases in `public-members.test.ts` that only test `public-compat`. If the whole file is about it, delete the file, and keep any case that covers other behaviour.
2. **The rest.** Delete `smoke-client.ts` and the five functions. Before each deletion, re-run `git grep -lw <name> -- apps packages`; if anything else uses one, keep it and say so.
3. **Cleanup.** Remove the imports and helpers that become unused.
4. **No new tests. Report the line counts.**

### Allowed files
- `apps/server/src/topics/public-compat.ts`
- `apps/server/src/topics/public-members.test.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/connections/smoke-client.ts`
- `apps/server/src/agents/delegation/service.ts`
- `apps/server/src/web-tools/html.ts`
- `apps/server/src/ais/queries.ts`
- `apps/server/src/stickers/image.ts`
- `apps/server/src/app.ts`
- `work/T-2101-server-dead-code.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 120 lower.

---

## Report (written by the worker when done)

### What I did
- Deleted `apps/server/src/topics/public-compat.ts` and its two call sites:
  `finishJoin` (`groups/join.ts`) and `addGroupMembers` (`groups/members.ts`) no
  longer call `addToPublicTopics`; `topics/service.ts` now uses `[input.actorId]`
  for a public topic's initial members (private branch unchanged).
- Deleted `apps/server/src/connections/smoke-client.ts`.
- Deleted the five functions: `cancelDelegation`, `anchorParts`, `findAiForGateway`,
  `isAnimatedImage`, `effectMountsOf`. Before each deletion, `git grep -lw <name> -- apps packages`
  showed only its own file (re-checked after the edits: no references remain).
- Removed the helpers that became unused: `AnchorParts`, the `findCloseTag` /
  `nextOpenTag` / `stripTags` imports in `web-tools/html.ts`, `SqlError` in
  `ais/queries.ts`, `mountsByApp` in `app.ts`, and (only caller was
  `findAiForGateway`) `findGatewayAiEffect` and its `GatewayAiRecord` interface in
  `ais/queries.ts`. `effectMountsOf` was the only reader of `mountsByApp`.
- `public-members.test.ts`: removed the two cases that only covered the deleted
  code ("gives only the creator when the compat switch is on…" and "keeps the
  membership when the public-topic write fails") and the `public-compat` imports;
  kept the seven cases covering topic creation, joining, patching and channel
  audiences. Updated the file header comment to drop the compat-switch wording.
- Line counts (`git diff --numstat HEAD -- apps`): 5 insertions, 289 deletions,
  net **-284 product lines** (86 deleted-file lines: public-compat 63 +
  smoke-client 28, minus 5 small replacements). Acceptance asked for at least 120 lower.

### Checks run
- `pnpm install`: Done in 20.7s using pnpm v10.32.1.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics`:
  Test Files 9 passed (9), Tests 40 passed (40), Duration 17.04s.
- `pnpm gate`:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.4s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/server  (103.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Notes for the lead
- No other file in `apps`/`packages` used any of the deleted names; I kept nothing.
- Beyond the five named functions I also deleted `findGatewayAiEffect` and
  `GatewayAiRecord` in `ais/queries.ts`: `findAiForGateway` was their only caller,
  so they became dead code in an Allowed file. Same for the `mountsByApp` WeakMap.
- No behaviour change intended: new public topics still start with just their
  creator, and adding a group member still writes no topic memberships.
- I did not edit `work/BOARD.md`; the branch is committed but not pushed.

## Review (written by Claude)

Approved; the pre-review was clean (2 nits).
- **What changed.** Deletions only (−284).
  - `public-compat.ts` is gone; its two no-op `addToPublicTopics` calls and their try/warn blocks went with it, and topic creation now uses `[input.actorId]` directly. Same behaviour: new public topics start empty (Julio, 10-16).
  - `smoke-client.ts` is gone.
  - So are five uncalled functions, and the tests of the removed compat path.
