---
id: T-0914
title: "Store core T7a: the mobile store on the core incoming events, message actions and reads (history stays for T7b)"
status: todo
milestone: M5
branch: task/T-0914-store-core-t7a-mobile-incoming
model: auto
effort: default
depends_on: [T-0905, T-0906, T-0907]
estimate: 1 day
---

# T-0914: Store core T7a, mobile on core incoming, actions and reads

## Spec (written by Claude, do not edit)

### Why
This is the incoming, actions and reads half of task T7 in `docs/STORE_CORE_PLAN.md` (section 6). History follows in T7b, after T-0912 moves web history into the core.

T-0907 (merged) created these files in `packages/client-core/src/store/`, and the web store runs on them: `ctx.ts`, `ports.ts`, `incoming.ts`, `actions.ts`, `reads.ts` and `test-ctx.ts`.

The lead located the mobile code on main on 2026-10-10. The plan's line numbers are stale, because T-0906 cut `apps/mobile/src/store/real-store.ts` to 957 lines:
- `recordRead` `:261`;
- `linkAck` `:514-518`, the T-0906 helper passed as `linkLocalToServer` at `:787`;
- `setHistoryLoad` `:525`;
- `clearSupersededMarker` `:532`;
- `handleMessage` `:546`;
- `handleDisplayed` `:679`.

`apps/mobile/src/store/effects/events.ts` (397 lines) has typing and the react, edit and delete actions (`makeEvents` `:53`).

### What to build
1. **Tests first,** if plan section 7 or your reading finds an uncovered mobile path in incoming, actions or reads. Put them in a new file, `apps/mobile/src/store/real-store.incoming.test.ts`, committed on the old code. For example: typing clears after 5 s and on `paused`, a displayed marker, and react, edit and delete round trips.
2. **The move:**
   - `real-store.ts` replaces `handleMessage` and the other incoming handlers, plus `recordRead`, with the core `incoming` and `reads`, as web does after T-0907 (read `apps/web/src/store/effects/ctx.ts` and `realStore.ts` for the wiring).
   - `effects/events.ts` keeps prefs and folders, and its typing and react, edit and delete actions become the core `actions`.
   - `effects/runtime.ts`: `StoreHelpers` shrinks.
   - Mobile's `actionError?:` type gets `| undefined` so mobile's `set` fits the core `CoreSet` (T-0907's note).
3. **Ack sites:** switch the 3 ack sites in `apps/mobile/src/store/effects/send.ts` (`acknowledge`, attachment, voice) to the core `linkAckToServer` with the chat, and delete the `linkAck` workaround in `real-store.ts` (T-0906's Review).
4. **Unchanged:** history (`effects/history.ts`, `setHistoryLoad`, `clearSupersededMarker`) stays as it is for T7b. No behaviour change, and no existing test edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0914/`; use `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 4, 6 (T7) and 7, the Reports of `work/T-0906-*.md` and `work/T-0907-*.md`, `packages/client-core/src/store/*`, and the mobile store.

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.incoming.test.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/actions.ts` and `packages/client-core/src/store/reads.ts` (only small, tested extensions mobile needs; say why), `packages/client-core/src/store/*.test.ts` (new cases only), `work/T-0914-store-core-t7a-mobile-incoming.md`.

T-0912 changes the web store, `packages/client-core/src/store/history.ts` and the T6 section of `index.ts` in parallel. Do not touch them.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
ZILAR_SMOKE_DIR=<scratchpad>/T-0914/smoke ZILAR_ROUTES="/ /settings" pnpm phone:smoke task/T-0914-store-core-t7a-mobile-incoming
```
Run the mobile `src/store` tests 3 times.

### Acceptance
- The Checks pass, 3 runs, and the phone smoke is clean.
- No existing test is edited.
- The Report gives the lines per side and either "no behaviour change" or the list of changes.
- Live check for Julio: on the phone, receiving messages, typing, read marks, reactions, edits and deletes.

---

## Report (written by the worker when done)

## Review (written by Claude)
