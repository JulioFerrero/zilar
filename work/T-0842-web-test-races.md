---
id: T-0842
title: "CI red on main: two web tests race the Effect scheduler (MessageSearchResults path check, Composer voice flushStart); wait for the visible state instead of one tick"
status: merged
milestone: M5
branch: task/T-0842-web-test-races
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0842: two web tests race the Effect scheduler

## Spec (written by Claude, do not edit)

### Why
CI on main is red.
- **`MessageSearchResults`:** the "Test" job failed on 3 main runs in a row (14454369, 899be14b, ee84523a; last green 501ee185 at 16:23 UTC). The test is "groups hits under the chat title and opens a hit on click": `expected '/' to be '/c/c-ana'`.
- **`Composer.voice`:** on ee84523a, "clicks to record and sends through the Send button" also failed with `Unable to find a label with the text of: Send voice message`. It also failed in the lead's wave check under heavy load.
- **Locally,** both files pass 18 of 18, 3 of 3 runs, at low load.

Both tests assume the component reacts within one tick. Since the Effect conversions (T-0789 WU25 search results; T-0809 WU18 Composer), the reaction runs on Effect's scheduler, which can take more than one macrotask on a busy machine. The app behaviour is fine; the tests are too tight.

### Verified facts (re-read before editing)
- **`apps/web/src/components/MessageSearchResults.test.tsx`:**
  - The failing test, at about lines 105-114, waits for `store.getState().activeChatId` to be `'c-ana'` (line 112).
  - It then reads `screen.getByTestId('path').textContent` synchronously (line 113), but the navigation comes a little after the store change.
- **`apps/web/src/components/Composer.voice.test.tsx`:**
  - `flushStart` at lines 33-37 waits a single `setTimeout(0)` inside `act`.
  - The tests then assert at once with `getBy…`: for example at 79 (`'Slide to cancel'`), 83 and 158 (`'Send voice message'`), and 107.

### What to build (tests only; no source change)
1. **`MessageSearchResults.test.tsx`:** in that test, wait for the path, with `await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/c/c-ana'))`. Check the other tests in the file for the same pattern (a synchronous read right after an awaited store change) and fix them the same way.
2. **`Composer.voice.test.tsx`:** make every assertion that follows `flushStart`, `releaseMic` or a click wait for the state it expects (`await screen.findByLabelText(...)` or `waitFor`), instead of reading it in the same tick. You may also make `flushStart` wait until the recorder state shows: for example `await screen.findByText('Slide to cancel')` where recording is expected. Keep each test's steps and expectations the same.
3. **Reproduce the flake before fixing,** and show it is gone after. Run the two files under CPU load: start 6 `yes > /dev/null` processes in the background, run `pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/Composer.voice.test.tsx src/components/MessageSearchResults.test.tsx` 10 times, then kill the `yes` processes. Do this once before the fix and once after, and record the pass counts. **Always kill the `yes` processes,** even on failure.

### Read first
`AGENTS.md`, the two test files, and the components they render (`apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/Composer.tsx`), so you know which visible state each step leads to.

### Allowed files
`apps/web/src/components/MessageSearchResults.test.tsx`, `apps/web/src/components/Composer.voice.test.tsx`, `work/T-0842-web-test-races.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/Composer.voice.test.tsx src/components/MessageSearchResults.test.tsx
pnpm exec oxlint apps/web/src/components/MessageSearchResults.test.tsx apps/web/src/components/Composer.voice.test.tsx
```
Plus the load runs above.

### Acceptance
- Under the load run, after the fix: 10 of 10 pass. Report the before count.
- No source file changes; oxlint is clean, and only Allowed files change.

---

## Report (written by the worker when done)

### Files changed
`apps/web/src/components/MessageSearchResults.test.tsx`, `apps/web/src/components/Composer.voice.test.tsx`, this task file. No source changes.

### Load runs (6 `yes` processes, 10 runs of the two files)
- Before the fix: 10 of 10 passed. I could not reproduce the flake. I also tried 22 `yes` processes (2 per CPU, 11 CPUs): 10 of 10 passed.
- After the fix: 10 of 10 passed (6 `yes`).
- So the load run shows no regression but does not prove the fix. The change follows from reading the tests against the spec's verified facts.
- `yes` processes killed after each run (`pgrep -x yes` shows 0).

### Assertions changed
- `MessageSearchResults.test.tsx`, "groups hits under the chat title and opens a hit on click": the `path` read is now `await waitFor(...)`. The navigation happens after the store change. The other tests in the file have no such pattern. The last test's `'/'` read after `findByRole('alert')` is a negative check that cannot wait, and I left it.
- `Composer.voice.test.tsx` (added `waitFor` import):
  - `getByText('Slide to cancel')` became `await findByText` (tests 1, 4, 7). I also added the same wait after `flushStart` in the three hold tests (too short, `stop()` rejects, reply set after mount). They now wait for the recorder to be running before the 500 ms hold, so the release cannot happen before `start()` is applied.
  - `getByLabelText('Send voice message')` / `'Cancel voice message'` became `await findByLabelText` after `releaseMic`, after `flushStart` (click mode), and in the trash and Escape tests.
  - The "message was added" `toHaveLength(before + 1)` checks became `await waitFor(...)` (tests 1, 4, 10, 11). In test 10 the `sent` array is read after the wait.
  - Chat-switch test: the `cancelSpy` and `queryByText('Slide to cancel')` null checks became `waitFor`.
  - Kept as they were: the "nothing sent" length checks (negative) and the checks after the sync `fireEvent.click(Cancel)` / Escape handlers.
- Steps and expectations are unchanged.

### Checks
- vitest of the two files: 2 files, 18 tests passed.
- `pnpm exec oxlint` on the two files: exit 0, no output. prettier applied.
- I did not run `pnpm gate` or the full suite (lead's instruction).

### Unsure
Because I could not reproduce the failure, I cannot confirm that these waits fix the CI failures in the lead's wave check or on CI. The `Send voice message` failure on ee84523a is covered by the new `findByLabelText` calls.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report.
- **The change:** test only. The MessageSearchResults test waits for the `/c/c-ana` path, and the Composer voice tests wait with `findBy`/`waitFor` for each visible state instead of one tick.
- **Reproduction:** the flake did not reproduce locally, even with 22 CPU-burning processes; both files pass 10 of 10 before and after.
- **Verification:** main CI after the merge is the check. If MessageSearchResults still fails there, the cause is not timing, and the lead opens a follow-up.
