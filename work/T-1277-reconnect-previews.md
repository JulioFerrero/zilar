---
id: T-1277
title: "PERF-1: a (re)connect no longer sends one archive query per chat in an unbounded burst — chats whose preview and cursor are already known are skipped, the rest run 4 at a time, and each chat's preview is one store update; tested"
status: merged
milestone: M5
branch: task/T-1277-reconnect-previews
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1277: Fewer queries per reconnect

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md` PERF-1 (P1, `:91-105`). After every successful connect, `packages/client-core/src/store/lifecycle.ts:394-397` runs `loadPreview` for **every** chat with `concurrency: 'unbounded'`.
- **The query:** `loadPreview` (`packages/client-core/src/store/history.ts:180-218`) sends one MAM query (`max: PREVIEW_HISTORY_MAX` = 1, `:11`) per chat and calls `ctx.set` twice (`:203-209` and `:214-216`).
- **When it runs:** at every reconnect and every phone resume that lost the socket.
- **Why it's wasted:** most of these queries do nothing. The preview only fills an empty `lastMessage` (`:205`), and the server's chat list (T-1198) already sends `lastMessage` for most chats.
- **File sizes:** `history.ts` and `lifecycle.ts` are both exactly 400 lines.

### What to build
1. A new `packages/client-core/src/store/previews.ts` exporting `loadPreviews(ctx, current)`:
   - skips a chat whose `lastMessage` is set **and** whose cursor is already known (`ctx.cursors[chat.id] !== undefined`);
   - runs the rest through `loadPreview` with `concurrency: 4`.
2. In `lifecycle.ts`, replace `:394-397` with a call to `loadPreviews`, so the file shrinks.
3. In `history.ts`, merge `loadPreview`'s two `ctx.set` calls into one (the chat row and `historyComplete` together). The file must not grow past 400 lines; move `loadPreview` into `previews.ts` if needed, and keep its export path working for its importers (cite them).
4. **Tests** (the message pipeline), up to 2, in `packages/client-core/src/store/lifecycle.test.ts` or `history.test.ts`, whichever already tests `loadPreview` or connect:
   - a reconnect where every chat has a `lastMessage` and a cursor sends **no** `loadHistory`;
   - a chat without a `lastMessage` still gets its preview.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` PERF-1, `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/lifecycle.test.ts` and `packages/client-core/src/store/history.test.ts`.

### Allowed files
`packages/client-core/src/store/previews.ts`, `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/lifecycle.test.ts`, `packages/client-core/src/store/history.test.ts`, `packages/client-core/src/store/index.ts`, `work/T-1277-reconnect-previews.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- New `packages/client-core/src/store/previews.ts`: `loadPreviews(ctx, current)` filters the chats so one whose `lastMessage` is set **and** whose cursor is known (`ctx.cursors[chat.id] !== undefined`) is skipped, and runs the rest through `loadPreview` with `concurrency: PREVIEW_CONCURRENCY` = 4. Wrapped in `Effect.suspend` so the filter reads the chats/cursors when the effect runs.
- `lifecycle.ts`: replaced the `Effect.all(..., { concurrency: 'unbounded' })` preview block (`:394-397`) with `yield* loadPreviews(ctx, current)`; import now brings `loadPreviews` from `./previews` and `flushPending`/`HistoryCtx` from `./history` (dropped the now-unused `loadPreview` import). File shrank 400 → 398 lines.
- `history.ts`: merged `loadPreview`'s two `ctx.set` calls into one — the chat-row update now also carries `historyComplete` — so a preview notifies listeners once. File stayed at exactly 400 lines.
- `index.ts`: added `export * from './previews';` in the T6 section so `loadPreviews` is reachable from `@zilar/client-core/store` like the rest of the store modules.
- Tests (2, the daily message pipeline) in `history.test.ts` under a new `loadPreviews (core)` describe:
  - every chat with a `lastMessage` and a known cursor → `loadHistory` is never called;
  - a chat without a `lastMessage` (cursor known) still loads its preview and gets `lastMessage`.

### `loadPreview` export path (item 3, "cite them")
`loadPreview` stayed in `history.ts`, so nothing moved and its export path is unchanged: `@zilar/client-core/store` (index re-exports `./history`). Importers verified:
- `apps/web/src/store/effects/history.ts:9,28` (imports and re-exports `loadPreview` from `@zilar/client-core/store`);
- `apps/mobile/src/store/effects/history.ts:15` (`loadPreview as loadPreviewCore` from `@zilar/client-core/store`).

### Files changed
- `packages/client-core/src/store/previews.ts` (new, 28 lines)
- `packages/client-core/src/store/history.ts` (400 lines)
- `packages/client-core/src/store/lifecycle.ts` (398 lines)
- `packages/client-core/src/store/history.test.ts` (361 lines)
- `packages/client-core/src/store/index.ts`
- `work/T-1277-reconnect-previews.md`

### Commands and results
- `pnpm install` — Done, no errors.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts src/store/history.test.ts` — **2 files passed, 32 tests passed** (1.47s). The only stdout noise was an existing expected `ERROR ... createXmpp is not provided in this test` log from the "boot bookkeeping" test; it is not a failure.
- First `pnpm gate`: **GATE FAIL** on `format` (`history.test.ts`). I ran `pnpm exec prettier --write packages/client-core/src/store/history.test.ts` and re-ran.
- Second `pnpm gate` — **GATE PASS**:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`

### Deviations / notes
- Item 4 said the tests go where `loadPreview` or connect is already tested; I put them in `history.test.ts` and exercise `loadPreviews` directly (the function the connect path now calls) rather than driving a full `startStore` boot, which keeps the test small and deterministic.
- Kept `loadPreview` in `history.ts` (the line budget did not require a move), so the merge in item 3 happens in `history.ts` as the spec words it.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 nits).**
- **The change:**
  - a new `store/previews.ts` (`loadPreviews`) skips chats whose `lastMessage` and cursor are both known, and runs the rest 4 at a time;
  - `lifecycle.ts` calls it (398 lines);
  - `loadPreview` makes one `ctx.set` (`history.ts` stays at 400).
  - Tests: 2 new cases in `history.test.ts`.
- **Lead's checks after the rebase:** client-core 133 passed; tsc on web and mobile: 0 errors.
- **Effect:** a reconnect on a warm client now sends no preview MAM queries for known chats, which closes PERF-1's burst. Windowed message lists (PERF-3, web) remain a separate item.
