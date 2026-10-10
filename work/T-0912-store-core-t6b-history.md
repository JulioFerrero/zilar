---
id: T-0912
title: "Store core T6b: web history (first page, older pages, open at message) in packages/client-core, tests first, with the loadOlder overlap fix"
status: todo
milestone: M5
branch: task/T-0912-store-core-t6b-history
model: auto
effort: default
depends_on: [T-0907]
estimate: 1 day
---

# T-0912: Store core T6b, history

## Spec (written by Claude, do not edit)

### Why
This is the history half of task T6 in `docs/STORE_CORE_PLAN.md`. T-0907 moved incoming events, message actions and reads into `packages/client-core/src/store/`, and split history off under the plan's 800-line rule.

T-0907 also found a bug that is on main. If `loadOlder` runs while a chat's first history page is still loading, it pages back from the boot preview's cursor and does not de-duplicate the overlap: a probe with 60 messages gave 100 bubbles for 51 unique ids. The code is `apps/web/src/store/effects/history.ts`: `loadOlderPage` at `:72`, `loadOlder` at `:246-251` and its other caller at `:328`. The file has 496 lines.

The plan's section 7 also lists two `loadOlder` calls at once as uncovered.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.history.test.tsx`, committed on the old code:
   - **What must not change:** the first page, older pages until complete, open at a message (jump from search), and the topic-gone case.
   - **New expectations, failing on the old code** (one commit):
     - `loadOlder` during the first page load ends with each message exactly once, in order;
     - two `loadOlder` calls at once fetch one page, not two.
2. **Core:** a new `packages/client-core/src/store/history.ts` with its test, on the ctx and ports that T-0907 created (`packages/client-core/src/store/ctx.ts` and `ports.ts`), plus a line in the T6 section of `index.ts`. Fix the overlap: do not page from a preview cursor while the first page is in flight, or de-duplicate by message id on merge; say which.
3. **Web:** `apps/web/src/store/effects/history.ts` becomes a binding over the core, or is deleted. `realStore.ts` keeps its facade.
4. **Mobile:** check whether mobile's `apps/mobile/src/store/effects/history.ts` has the same overlap race. Write the answer with `file:line` in the Report; do not change mobile, because T7 carries it.
5. **Unchanged:** everything else in behaviour, and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0912/`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 4, 6 (T6) and 7, the Report of `work/T-0907-store-core-t6-incoming-history.md`, `packages/client-core/src/store/*`, and `apps/web/src/store/effects/history.ts` with its test.

### Allowed files
`packages/client-core/src/store/history.ts`, `packages/client-core/src/store/history.test.ts`, `packages/client-core/src/store/index.ts` (T6 section only), `packages/client-core/src/store/ctx.ts` and `packages/client-core/src/store/ports.ts` (only what history needs), `apps/web/src/store/effects/history.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.history.test.tsx`, `work/T-0912-store-core-t6b-history.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the `realStore*.test.tsx` files and `effects/history.test.ts` 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side, the overlap fix, and the mobile verdict.
- Live check for Julio: on web, scroll back in a long chat right after opening it, and jump to a message from search.

---

## Report (written by the worker when done)

## Review (written by Claude)
