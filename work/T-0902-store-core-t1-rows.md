---
id: T-0902
title: "Store core T1 (pilot): @zilar/client-core/store subpath and the pure row helpers moved from both stores"
status: merged
milestone: M5
branch: task/T-0902-store-core-t1-rows
model: auto
effort: default
depends_on: [T-0896, T-0900]
estimate: 0.5 day
---

# T-0902: Store core T1 (pilot)

## Spec (written by Claude, do not edit)

### Why
This is the first task of the store core split in `docs/STORE_CORE_PLAN.md`, "T1, pilot: store package wiring and pure row helpers" in section 6. Follow that section exactly. The lead re-checked its line numbers on main on 2026-10-10, and they match:
- mobile `real-store.ts:80` `rememberFinishedDraftMessage`, `:137` `sortMessages` and `:924` `advanceStatus`;
- web `chatRows.ts:6` `sortByRecency`;
- web `polling.ts:120` `withoutDraft`;
- web `constants.ts:30` `FINISHED_TURNS_MAX`.

This branch starts from `task/T-0900-deps-catalog`, because both tasks change `packages/client-core/package.json` and `pnpm-lock.yaml`. T-0900's files are carried, and the combined check merges T-0900 first.

### What to build
Do what plan section 6 T1 lists, under "Rules for every task" in section 6:
1. **Core:**
   - `packages/client-core/package.json` gets the dependencies `@zilar/chat-core`, `@zilar/protocol`, `@zilar/xmpp-core` and `@zilar/api-contract` (`workspace:*`) and the export `"./store": "./src/store/index.ts"`;
   - new `packages/client-core/src/store/index.ts`, with one section per future task (T1 to T10) as comment blocks, like the contract's former chain blocks;
   - new `packages/client-core/src/store/rows.ts` with the identical pure helpers, and `rows.test.ts`;
   - run `pnpm install`.
2. **Web:**
   - `apps/web/src/store/effects/chatRows.ts` re-exports the 7 helpers instead of defining them;
   - `apps/web/src/store/effects/polling.ts` re-exports `withoutDraft`;
   - `apps/web/src/store/effects/constants.ts` re-exports `FINISHED_TURNS_MAX`.
3. **Mobile:**
   - `apps/mobile/src/store/real-store.ts` imports the helpers and deletes the copies the plan lists (`h.clearFailure` keeps its name);
   - `apps/mobile/src/store/effects/polling.ts` re-exports `withoutDraft` and `FINISHED_TURNS_MAX`.
4. **Metro:** run `pnpm phone:smoke <your branch>` once to prove Metro resolves the new subpath (`ZILAR_ROUTES="/ /settings"` is enough). If Metro fails on the subpath, report the error and stop; do not work around it in Metro config.
5. **Behaviour:** none changes. Existing store tests are not edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0902/`), and `docs/STORE_CORE_PLAN.md` sections 4 to 6.

### Allowed files
`packages/client-core/package.json`, `packages/client-core/src/store/**`, `pnpm-lock.yaml`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/constants.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/polling.ts`, `work/T-0902-store-core-t1-rows.md`.

The files carried by the merge of T-0900 are also allowed: `pnpm-workspace.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json` and `work/T-0900-deps-catalog.md`.

Do not touch `real-store.ts` `teardown()` or the store's initial state (`:1757-1800`): T-0901 changes them in parallel.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
ZILAR_SMOKE_DIR=<scratchpad>/T-0902/smoke ZILAR_ROUTES="/ /settings" pnpm phone:smoke task/T-0902-store-core-t1-rows
```

### Acceptance
- The Checks pass, including the phone smoke.
- No existing test is edited.
- The Report gives the lines per side, which should be close to the plan's estimate (core +130, web -80, mobile -75).

---

## Report (written by the worker when done)

- Core: `@zilar/client-core` got the four workspace deps and the `./store` export. New `src/store/index.ts` has one comment section per task (T1 live, T2, T3, T6, T8, T10). New `src/store/rows.ts` holds the 8 helpers plus `FINISHED_TURNS_MAX`, and `rows.test.ts` has 13 tests. Lines: +about 105 in rows.ts, +about 100 in the test, +about 30 in index.ts (core is about +235 including test and index; the plan said +130 for code).
- Web: `chatRows.ts` re-exports 7 helpers (-86 net), `polling.ts` imports and re-exports `withoutDraft` (-6 net), `constants.ts` re-exports `FINISHED_TURNS_MAX` (0 net). About -90 total (plan: -80).
- Mobile: `real-store.ts` -85 net (7 helper copies removed, one import added); `effects/polling.ts` -12 net (also dropped the now-unused `DraftState` import). About -97 (plan: -75).
- Checks: client-core vitest 4 files / 61 tests pass; web `src/store` 16 files / 214 pass; mobile `src/store` 30 files / 306 pass, 1 skipped (already skipped before). Typecheck of client-core, web and mobile clean. Prettier and oxlint clean on the changed files.
- Phone smoke: `SMOKE PASS` for `/` and `/settings` on emulator-5554; Metro resolved `@zilar/client-core/store`. Both screenshots show the chat list and the settings page rendered normally.
- Differences from the plan: none in behaviour. No existing test was edited. `pnpm gate` was not run (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What landed:** `@zilar/client-core/store` exists with the pure row helpers, and both stores import them. That is core +105 code lines, web −90 and mobile −97, with no behaviour change and no existing test edited.
- **Metro:** it resolves the subpath, and the phone smoke shows the chat list and settings rendering normally.
- **Next:** T2 and T3 of `docs/STORE_CORE_PLAN.md` can start.
- **Check:** the combined wave 6 check passes.
