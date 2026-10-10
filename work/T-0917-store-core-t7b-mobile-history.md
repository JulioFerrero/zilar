---
id: T-0917
title: "Store core T7b: the mobile store on the core history (first page, older pages, open at message), with the loadOlder overlap fix, tests first"
status: todo
milestone: M5
branch: task/T-0917-store-core-t7b-mobile-history
model: auto
effort: default
depends_on: [T-0912, T-0914]
estimate: 1 day
---

# T-0917: Store core T7b, mobile on the core history

## Spec (written by Claude, do not edit)

### Why
This is the history half of task T7 in `docs/STORE_CORE_PLAN.md` (section 6).
- **T-0912 (merged)** moved web history into `packages/client-core/src/store/history.ts` (357 lines), which de-duplicates an older page by message id.
- **T-0914 (merged)** moved mobile incoming events, actions and reads onto the core.

Mobile has the overlap race T-0912 fixed on web. The lead located it on main on 2026-10-10:
- `apps/mobile/src/store/effects/history.ts` (524 lines): `loadOlderPage` at `:356`, `loadOlder` at `:396-401`, and another caller at `:463`. T-0912 also cited the boot preview cursor at `:157` and the merge without de-duplication at `:385`; re-check those two.
- `apps/mobile/src/components/chat/message-list.tsx:366-367`: scrolling near the top calls `loadOlder`.

Names differ between the apps. Mobile has `historyLoad` with `'loading' | 'loaded' | 'error'` (`apps/mobile/src/store/real-store.ts:487-504`: `setHistoryLoad`, `clearSupersededMarker`). The core uses `historyState` with `'ready'`, as T-0912's Report says.

### What to build
1. **Tests first,** in a new file `apps/mobile/src/store/real-store.history.test.ts`:
   - committed on the old code, what must not change: the first page, older pages until complete, open at a message (jump from search), and the topic-gone case;
   - then a failing commit: `loadOlder` during the first page load ends with each message exactly once, in order, whichever page lands first.
2. **The move:**
   - `effects/history.ts` becomes a binding over the core `history.ts`. Keep `loadPrefRows`, `loadFolders`, `reloadChats` and `jumpTarget` as adapter code, as plan T7 says.
   - `real-store.ts` drops `setHistoryLoad` and `clearSupersededMarker` if the core owns them.
   - Map mobile's `historyLoad`/`'loaded'` to the core's names with the smallest adapter. Do not rename the mobile state the screens read (`historyLoad`) in this task; screens are out of scope.
3. **Unchanged:** the only behaviour change is the overlap fix. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` section 6 (T7), the Reports of `work/T-0912-store-core-t6b-history.md` and `work/T-0914-store-core-t7a-mobile-incoming.md`, `packages/client-core/src/store/history.ts` with its test, and `apps/mobile/src/store/effects/history.ts` with its test.

### Allowed files
`apps/mobile/src/store/effects/history.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.history.test.ts`, `packages/client-core/src/store/history.ts` (only small, tested additions mobile needs; say why), `packages/client-core/src/store/history.test.ts` (new cases only), `work/T-0917-store-core-t7b-mobile-history.md`.

T-0916 removes a small wrapper at `real-store.ts:548-557` in parallel. Do not touch it. T-0915 changes the web store and core `ports.ts` and `ctx.ts`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the mobile `src/store` tests 3 times. The lead runs the phone smoke.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and the name mapping.
- Live check for Julio: on the phone, open a long chat and scroll up right away; each message shows once, in order.

---

## Report (written by the worker when done)

## Review (written by Claude)
