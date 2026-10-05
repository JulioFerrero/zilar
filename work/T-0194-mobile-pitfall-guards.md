---
id: T-0194
title: Mobile: guard tests for the Android and Hermes pitfalls that crashed the app
status: planned
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
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 native-pitfalls gradient-swap
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

## Review (written by Claude)
