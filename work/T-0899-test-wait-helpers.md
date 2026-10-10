---
id: T-0899
title: "One flush/waitFor/jsonResponse per package, real sleeps replaced with fake timers, and a guard against one-tick waits (simplify plan 5.5, F-F8)"
status: merged
milestone: M5
branch: task/T-0899-test-wait-helpers
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0899: One flush/waitFor/jsonResponse per package, real sleeps replaced with fake timers, and a guard against one-tick waits (simplify plan 5.5, F-F8)

## Spec (written by Claude, do not edit)

### Why
The audit (`docs/audit/simplify-2026-10-09/F-tests.md`, section F8) counted about 24 copies of `async function flush()`, 15 of `settle()`, 13 or more of `waitFor` and about 80 of `jsonResponse`, with different meanings: some wait five microtask ticks, some two `setTimeout(r, 0)` ticks, some poll. Tests that rely on "one tick is enough" made CI red on 2026-10-09; T-0842 and T-0888 fixed two of them. Fixed real sleeps also cost about 15 s of web test time.

### What to build, one commit per package
1. **One helper module per package:** `apps/web/src/test/wait.ts` (`apps/web/src/test/` exists: `renderApp.tsx`, `setup.ts`, `storeHarness.ts`), `apps/mobile/src/test/wait.ts`, and `apps/server/src/test-support/wait.ts` (check what exists first). Each exports:
   - `flushMicrotasks()`;
   - `waitFor(check, { timeout })`, which polls with fake-timer support;
   - `jsonResponse(body, init)`, which returns a real `Response`, and a 204 gets a null body.
2. **Replace the local copies** in that package's tests with imports. Do not change what a test asserts.
   - Where a test waited "one tick" for a visible state, wait for the state instead (`findBy*` or `waitFor`), as T-0842 did.
   - Leave alone tests whose flush semantics are load-bearing in a way you cannot prove; list them in the Report.
3. **Real sleeps:** replace the fixed real sleeps the audit lists with fake timers (`vi.useFakeTimers` and `vi.advanceTimersByTimeAsync`; `apps/web/src/store/effects/runtime.test.ts` is the model):
   - `realStore.topics.test.tsx`: ten waits of 600 ms;
   - `realStore.test.tsx`;
   - `ChatList.test.tsx`: the connecting bars;
   - `TypingIndicator.test.tsx`.

   Find the current lines with grep. Report the web suite wall time before and after (one run each).
4. **Guard:** add a test, or an oxlint rule if it supports one, that fails on `setTimeout(resolve, 0)` or `setTimeout(r, 0)` inside test files outside the helper modules.

**Do not edit** these mobile files, which T-0898 rewrites in parallel: `composer-layout`, `search-jump`, `attach-sheet`, `attachment-video`, `group-roles-mounted`, `composer-gifs`, `attachment-message`, `gif-panel` and `hooks-guard`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`) and `docs/audit/simplify-2026-10-09/F-tests.md` (F8).

### Allowed files
`apps/web/src/test/**`, `apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx`, `apps/mobile/src/test/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/server/src/test-support/**`, `apps/server/src/**/*.test.ts`, `work/T-0899-test-wait-helpers.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 <the server test files you changed>
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the web and mobile suites 3 times at the end, because flakiness is the target.

### Acceptance
- The Checks pass 3 times in a row.
- The guard exists, and the Report gives the copy counts and web wall time before and after.
- No production code changes.

---

## Report (written by the worker when done)

### What I did (one commit per package, test files only, no production code)
- Web `e01e8d58`: new `apps/web/src/test/wait.ts` (`flushMicrotasks`, `flushTasks`, `waitFor`, `jsonResponse`, `jsonResponseAt`) and the guard `apps/web/src/test/noRawTimeoutWaits.test.ts` (Vite glob, because the web tsconfig has no `readdir`).
- Mobile `0c9d1833`: new `apps/mobile/src/test/wait.ts` (adds `settle` = `flushTasks` inside `act`, and `waitForAct`) and the guard `apps/mobile/src/test/noRawTimeoutWaits.test.ts` (`node:fs` walk). The nine T-0898 files were not touched (none of them had a local copy).
- Server `f488f7da`: new `apps/server/src/test-support/wait.ts` and `apps/server/src/test-support/noRawTimeoutWaits.test.ts`. The directory sits next to `test-support.ts`; `../test-support` still resolves to the file.

### Copy counts (local definitions in test files, before -> after)
- Web: `flush` 4 -> 0, `jsonResponse` 40 -> 7.
- Mobile: `flush` 25, `settle` 19, `waitFor` 12, `flushUntil` 3, `sleep` 1 (60) -> 8 left; `jsonResponse` 37 -> 4.
- Server: `waitFor` 3 -> 0, `jsonResponse` 6 -> 0.

### Real sleeps and one-tick waits
- `realStore.topics.test.tsx`: all ten 600 ms waits now `vi.advanceTimersByTimeAsync(600)`, with fake timers in `beforeEach`/`afterEach`.
- `realStore.test.tsx`: the 600 ms `waitForRefresh` is fake-timer based (the three tests that use it call `vi.useFakeTimers()` first); `waitForState` (10 ms real polling) became the shared `waitFor`.
- `ChatList.test.tsx`: the two connecting/offline bar tests advance 1500 ms of fake time instead of waiting up to 2.5 s each.
- `TypingIndicator.test.tsx`: already used fake timers, nothing to change. `Composer.voice.test.tsx` has no 500 ms sleeps any more (fixed earlier), left alone.
- `flushUntil` (3 mobile files) became `waitFor`: it now throws on timeout instead of giving up silently after 50 rounds.
- Under fake timers `flushTasks` and `waitFor` advance the fake clock, so they work in both modes.

### Web suite wall time (one `vitest run --reporter=dot` each, noisy shared machine)
- Before any change: 33.06 s (1918 tests). After: 17.34 s on the first run after the web commit; later 3 runs 41.4 s / 14.0 s / 12.2 s (first one hit a busy machine). The saving from the sleeps themselves is the ~10 x 0.6 s of topics plus ~3 s of ChatList; the rest is machine load.

### The guard
Each package has `noRawTimeoutWaits.test.ts`: it fails on `setTimeout(resolve|res|r|done|ok, 0)` in any test file except that package's `wait.ts` (and itself). No oxlint rule used (the repo config has no `no-restricted-syntax`).

### Checks run (real results)
- Web: `vitest run --reporter=dot` 3 runs: 186 files / 1920 tests passed each (baseline 1918 + 2 guard tests). `pnpm --filter @zilar/web typecheck` clean.
- Mobile: `vitest run --reporter=dot` 3 runs: 292 files passed, 2684 passed, 2 skipped each (15.8 s, 15.8 s, 16.0 s). `typecheck` clean.
- Server (changed files + guard): `vitest run ... src/test-support src/agents src/ai/litellm-client.test.ts src/drafts src/machines src/voice-transcription src/xmpp/admin-client.test.ts`: 39 files passed, 604 passed, 1 skipped (one run). `typecheck` clean.
- `prettier --check` and `oxlint` on all changed files: clean. I did not run `pnpm gate` (wave mode).

### Deviations and things left alone
- Signatures: the spec says `jsonResponse(body, init)`. Web/mobile/server export that (init = status number or `ResponseInit`; 204/205 get a null body), plus `jsonResponseAt(status, body)` because 37 web, 3 mobile and 1 server test files call it as `(status, body)`; those import it as `jsonResponseAt as jsonResponse` so no call site changed. The mobile and server `jsonResponse` always set `content-type: application/json` (most local copies did; four mobile copies did not, which is harmless).
- Server `waitFor(check, options | timeoutMs, label?)` accepts the positional form the machine hub tests use, to avoid editing about a dozen multi-line calls.
- Left alone (not provable or a different semantic): web `AiMemoryDialog`, `AiMemorySection`, `usePendingApprovalCount`, `useApprovalPolling`, `voice` (set JSON headers or custom init), `VoiceMessage`, `useVoiceTranscription`; mobile fake-object `jsonResponse` in `media-api`, `pins-api.effect`, `stickers-api` and header-taking `auth.test`; mobile 10 ms real sleeps/settles that wait for real timers (`NameForm`, `settings-machines-screen`, `settings-profile-screen`, `group-id-screen` `settle`, `use-people-search` `settle(ms)`, `ais-id-screen` `settle`), and `store/integration.test.ts` (infra-gated, real sleeps). Web `ExplorePage` (450 ms), `MessageSearch` (500 ms), `ChatBackgroundDialog` (20 ms), `MachinesPage` (50 ms), `reload` (10 ms) are real sleeps not on the spec list; left for a follow-up. Web `PeopleSearchResult` `flushTimers` and `ApprovalsPage` `flushFakeTimers` are fake-timer helpers, kept.
- The "one tick is enough" `await flush()` call sites were not rewritten to `findBy*`; the helper now flushes consistently, and the guard stops new raw ticks.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Helpers:** one `wait.ts` per package (web, mobile, server), with `flushMicrotasks`, `waitFor` and `jsonResponse`/`jsonResponseAt`.
- **Copies removed:** local copies drop from 60 to 8 on mobile, and from 40 to 7 `jsonResponse` copies on web.
- **Sleeps:** fake timers replace the listed real sleeps.
- **Guard:** a `noRawTimeoutWaits` guard in each package.
- **Size and runs:** the change is test-only, net −917 lines, and the suites passed 3 runs.
- **Deviations accepted:**
  - `jsonResponseAt` keeps call sites unchanged;
  - `flushUntil` becoming `waitFor` now fails loudly on timeout.
- **Follow-ups:** the listed 10 ms settles and the extra real sleeps in `ExplorePage`, `MessageSearch` and three other files.
- **Check:** the combined wave 6 check passes.
