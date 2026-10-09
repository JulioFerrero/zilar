---
id: T-0839
title: "MU22 follow-up: mobile message-search-list.tsx runs openSearchHitEffect (failures and defects show the miss notice); its search-jump source test follows"
status: merged
milestone: M5
branch: task/T-0839-mobile-search-list
model: auto
effort: default
depends_on: [T-0831]
estimate: 0.25 day
---

# T-0839: mobile message-search-list on Effect

## Spec (written by Claude, do not edit)

### Why
T-0831 (MU22) converted `search-jump.ts`. It left `apps/mobile/src/components/chat/message-search-list.tsx` as the only `needs-effect` file in mobile, because a source test pins its `.catch(`. This task finishes it. It is plan row MU22 in `docs/audit/effect-100-plan.md:434`.

### Verified facts (on main after T-0831 merged; re-read before editing)
- **The call site:** in `apps/mobile/src/components/chat/message-search-list.tsx`, `openHit` (about line 92) calls `void openSearchHit({ openAtMessage, pushChat, pushChatNotFound, onNotFound }, item.chatJid, item.messageId)` at line 98, with `.catch(() => { notFoundRef.current(item.chatJid); })` at 108-112. The comment says an unexpected failure ("history or router") must show the miss notice instead of leaving the user on a spinner.
- **The Effect version:** `apps/mobile/src/components/chat/search-jump.ts:35` exports `openSearchHitEffect(deps, chatId, messageId): Effect<'landed' | 'not-found', unknown>`. A rejected `openAtMessage` that is not the not-found signal is a **failure**. A throw from `pushChat`, `pushChatNotFound` or `onNotFound` (the router) happens inside `Effect.sync`, so it is a **defect**. `openSearchHit` at line 65 is its Promise edge.
- **The source test:** `apps/mobile/src/components/chat/search-jump.test.ts:75-87` reads the list file, slices from `'void openSearchHit('`, and expects `.catch(` and `notFoundRef.current` within the next 900 characters.

### What to build
1. In `openHit`, run `openSearchHitEffect(...)` with `Effect.runFork`, keeping the same deps object. Map both a failure and a defect to `notFoundRef.current(item.chatJid)`: `Effect.catch` plus `Effect.catchDefect`, both to an `Effect.sync` that calls it. Interruption does nothing. Drop the `openSearchHit` import if nothing else uses it. Keep the comments' meaning.
2. Update the test at `search-jump.test.ts:75-87` so it still guards the same rule against the new code: slice from `'openSearchHitEffect('` and expect `Effect.catch(`, `Effect.catchDefect(` and `notFoundRef.current` within the slice. Keep the test name.
3. Add a behaviour test in a new `apps/mobile/src/components/chat/message-search-list.test.tsx` only if the existing mobile test setup can render the list and press a hit simply. Otherwise say so in the Report.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the two files above, and `apps/mobile/src/components/chat/search-jump.ts`.

### Allowed files
`apps/mobile/src/components/chat/message-search-list.tsx`, `apps/mobile/src/components/chat/search-jump.test.ts`, `apps/mobile/src/components/chat/message-search-list.test.tsx` (new, optional), `work/T-0839-mobile-search-list.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/search-jump src/components/chat/message-search
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint apps/mobile/src/components/chat/message-search-list.tsx apps/mobile/src/components/chat/search-jump.test.ts
```

### Acceptance
- `message-search-list.tsx` is `effect` in `pnpm effect:map`.
- The Checks pass 3 of 3, oxlint is clean, and only Allowed files change.

---

## Report (written by the worker when done)

- **Files changed:** `apps/mobile/src/components/chat/message-search-list.tsx` (openHit now runs `openSearchHitEffect` with `Effect.runFork`; `Effect.catch` and `Effect.catchDefect` both map to one `Effect.sync` that calls `notFoundRef.current(item.chatJid)`; `openSearchHit` import replaced by `openSearchHitEffect`; `Effect` imported from `effect`) and `apps/mobile/src/components/chat/search-jump.test.ts` (the source test at lines 75-87 keeps its name; it now slices from `openSearchHitEffect(` and expects `Effect.catch(`, `Effect.catchDefect(` and `notFoundRef.current` within 900 characters).
- **Not changed:** `search-jump.ts` (`openSearchHit` stays exported; the search-jump test still uses it). `message-search-list.test.tsx` already existed (276 lines) and already covers the not-found path and the unexpected-failure path (`TypeError` rejection shows the miss notice), so I did not edit it or add a file.
- **effect:map:** `apps/mobile/src/components/chat/message-search-list.tsx` is `effect` (from `dist/effect-map/data.json`). `pnpm effect:map` prints only the summary line: 849 files, 383 effect, 33 needs-effect.
- **Test counts:** after: 22 passed (3 files: search-jump.test.ts, message-search-list.test.tsx, message-search.test.ts), run 3 times, 22/22 each time. Before: not run separately, but no test case was added or removed, so 22 before.
- **Checks:** `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/search-jump src/components/chat/message-search`: 22 passed, 3 of 3 runs. `pnpm --filter @zilar/mobile typecheck`: exit 0. `pnpm exec oxlint` on the two changed files: exit 0. Prettier `--write` on both files: unchanged.
- **Behaviour differences:** none intended. Failure and defect both show the miss notice as before; a throw from the router or the store is still caught as before. Interruption is not caught (no caller interrupts this fiber, so nothing changes in practice).
- **Unsure:** the source test's 900-character window is tight; it passes, but a longer deps object would push `Effect.catchDefect(` out of the window and fail the test. Not run: `pnpm gate` (wave mode).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead read the diff.
- **The change:** the list runs `openSearchHitEffect` with `runFork`. Both a failure and a defect (a router throw) show the miss notice, and interruption does nothing.
- **The source test** now pins `openSearchHitEffect(`, `Effect.catch(`, `Effect.catchDefect(` and `notFoundRef.current`.
- **Results:** the file is `effect`; 22 tests pass, 3 of 3 runs; typecheck and oxlint are clean.
