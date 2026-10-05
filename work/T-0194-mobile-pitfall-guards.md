---
id: T-0194
title: Mobile: guard tests for the Android and Hermes pitfalls that crashed the app
status: merged
milestone: M5
branch: task/T-0194-mobile-pitfall-guards
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0194: Mobile: guard tests for the Android and Hermes pitfalls that crashed the app

## Spec (written by Claude, do not edit)

### Why
Four bugs reached Julio's phone because nothing in the test suite could see them. Each one is a pattern in source files, so a test that scans the source can catch it forever. One such test already exists: `apps/mobile/src/lib/gradient-swap.test.ts` (read it first and copy its style: it walks the source tree with `readdirSync` and `readFileSync` and reports `file:line` offenders).

### Verified facts (do not re-derive)
- Expo modules cannot convert a `Promise` parameter inside a `Coroutine` async function. The Kotlin module `apps/mobile/modules/zilar-whistle/android/src/main/java/expo/modules/whistle/ZilarWhistleModule.kt` was broken by exactly this (`AsyncFunction("x") Coroutine { ..., promise: Promise -> }`). A plain `AsyncFunction("x") { path: String, promise: Promise -> ... }` is valid and is used today (lines 108 and 134). Today the word `Coroutine` appears in that file only in a comment (line 152).
- Hermes has no `crypto.subtle`. Today the string appears only in comments: `ZilarWhistleModule.kt` lines 98 and 152, and `apps/mobile/modules/zilar-whistle/src/download.ts` line 141 (a JSDoc line starting with ` * `, which the comment rule below skips).
- App chrome uses lucide icons, never emoji. Emoji characters are allowed only as emoji CONTENT (the emoji picker data, reaction content, sticker fallback). Do not write an emoji guard in this task.
- `pnpm test` for the mobile package is `vitest`; node `fs` works in these tests (the gradient test uses it).

### What to build
Add ONE test file `apps/mobile/src/lib/native-pitfalls.test.ts` with three `describe` blocks, each walking the sources and failing with the list of `file:line` offenders:
1. Kotlin: every `*.kt` file under `apps/mobile/modules` (walk the folder; skip nothing else). Ignore lines whose trimmed text starts with `//` or `*` or `/*`. Fail when a non-comment line contains `Coroutine` and, within the same statement (the same line or the next 6 lines until a line with `->`), the text `Promise`. Also assert you scanned at least one `.kt` file and that at least one `AsyncFunction` with a `Promise` parameter exists (so the guard cannot go blind if the file moves).
2. Hermes: every `.ts` and `.tsx` file under `apps/mobile/src` and `apps/mobile/modules/*/src`, excluding `*.test.ts` and `*.test.tsx`. Fail when a non-comment line contains `crypto.subtle` or `SubtleCrypto`. Assert you scanned more than 50 files.
3. Self-test of the detectors: export the two line-checking functions from a small helper in the same test file (or a `native-pitfalls-scan.ts` next to it) and prove each detector flags a bad sample string and passes a good sample (a Kotlin snippet with `Coroutine {` and `promise: Promise ->`, one with a plain `AsyncFunction`; a TS line using `crypto.subtle.digest` and one with a comment `// no crypto.subtle`).

No change to any existing source file.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/gradient-swap.test.ts`, `apps/mobile/modules/zilar-whistle/android/src/main/java/expo/modules/whistle/ZilarWhistleModule.kt`.

### Allowed files
`apps/mobile/src/lib/native-pitfalls.test.ts`, `apps/mobile/src/lib/native-pitfalls-scan.ts` (optional helper), `work/T-0194-mobile-pitfall-guards.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot native-pitfalls gradient-swap
pnpm gate
```

### Acceptance
- The tests pass on the current tree, and the detector self-tests prove a bad sample is flagged.
- Temporarily introducing `Coroutine { path: String, promise: Promise -> }` into the Kotlin file makes the Kotlin test fail with that file and line (try it once, tell the Report you did, and revert; never commit the bad line).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Fixing any pitfall found (none exist today), emoji detection, iOS code, any new dependency.

---

## Report (written by the worker when done)

### What I did

Added two files in `apps/mobile/src/lib/` that mirror the style of the existing `gradient-swap.test.ts` (walks the source tree with `node:fs`, reports `file:line` offenders):

- `native-pitfalls-scan.ts` — exports `findKotlinCoroutinePromiseOffenders`, `findHermesCryptoSubtleOffenders`, `kotlinFiles`, `hermesSourceFiles`. The line scanners are pure data-in / data-out so they can be exercised directly from the test. The Hermes patterns are built from parts (`crypto` + `.` + `subtle`, and `Subtle` + `Crypto`) so the helper itself does not contain the literal strings it scans for (a previous draft did and tripped the new guard).
- `native-pitfalls.test.ts` — three `describe` blocks:
  1. Kotlin: walks `apps/mobile/modules` for `.kt` files, runs the Kotlin scanner, also asserts the walk found at least one `.kt` file and at least one `AsyncFunction` whose parameter list contains `promise: Promise` (uses a small `fileHasAsyncFunctionWithPromise` helper in the test file that looks at the next 6 lines after each `AsyncFunction`).
  2. Hermes: walks `apps/mobile/src` plus every `apps/mobile/modules/*/src` directory, skipping `*.test.ts`/`*.test.tsx`, runs the Hermes scanner, asserts scanned > 50 files.
  3. Self-test: feeds the two scanners a bad and a good sample each and asserts the right result.

### Files changed

- `apps/mobile/src/lib/native-pitfalls-scan.ts` (new)
- `apps/mobile/src/lib/native-pitfalls.test.ts` (new)
- `work/T-0194-mobile-pitfall-guards.md` (status + this report)

### Commands and real results

- `pnpm install` — Done in 27.2s; 1053 packages added; 3 pre-existing deprecation warnings and 1 pre-existing peer-dependency warning (both unrelated to this task).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot native-pitfalls gradient-swap` — 2 files passed, 5 tests passed (the new 3 + the 2 pre-existing `gradient-swap` tests).
- Negative-test verification: temporarily edited `ZilarWhistleModule.kt` line 108 from `AsyncFunction("loadModel") { path: String, promise: Promise ->` to `AsyncFunction("loadModel") Coroutine { path: String, promise: Promise ->`, re-ran the new tests, and got `expected [Array(1)] to deeply equal []` with `[ ".../ZilarWhistleModule.kt:108" ]` as the offender (1 failed, 3 passed). Reverted the edit; `git diff` against `ZilarWhistleModule.kt` was empty afterwards. The bad line was never committed.
- `pnpm gate` from repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (9.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.9s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No files outside the Allowed files. The format check failed on the first gate run (Prettier flagged both new files); I ran `pnpm exec prettier --write` on the two files, and the second gate run passed.

### Problems / deviations

- The spec phrases the Kotlin "AsyncFunction with a Promise parameter" assertion loosely. A naive `AsyncFunction\(...\Promise\)\b` regex misses the real shape `AsyncFunction("loadModel") { path: String, promise: Promise ->` (the `Promise` is inside the lambda). I added a small scanner `fileHasAsyncFunctionWithPromise` in the test file that walks the next 6 lines after each `AsyncFunction` and matches `promise\s*:\s*Promise\b` — same intent, and it correctly counted the three `AsyncFunction`s that take a `promise: Promise` in `ZilarWhistleModule.kt` (lines 108, 134, 138-145).
- Prettier flagged the new files on the first gate. After `prettier --write` on the two files the gate is green. No semantic change.

### Open questions

None.

## Review (written by Claude)

**Verdict:** Approved, first round (MiniMax M3). `native-pitfalls.test.ts` scans every Kotlin file under `apps/mobile/modules` for a `Coroutine` async function with a `Promise` parameter and every app and module TypeScript file for `crypto.subtle`/`SubtleCrypto`, skipping comments, and fails with `file:line`; it asserts it scanned real files so it cannot go blind, and the detectors have their own good and bad samples. The worker did the negative test the spec asked for (a `Coroutine` on `ZilarWhistleModule.kt:108` was reported at that line, then reverted; the Kotlin file is not in the diff). Pre-review clean, no nits. Test-only, so no emulator check.
