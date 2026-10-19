---
id: T-2194
title: "Dead code left by tonight's merges: 5 exported functions nothing calls are deleted; no behaviour change"
status: merged
milestone: M5
branch: task/T-2194-dead-leftovers
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-2194: Delete 5 functions nothing calls

## Spec (written by Claude, do not edit)

### Why
Tonight's folds and test cuts left five exported functions that no file calls, its own included. The lead checked each with `git grep` on 2026-10-19.

### Facts
1. `apps/mobile/src/lib/pin-snapshot.ts:25-40`: `pinSnapshotText`. Nothing calls it; `pinLabel` from the same file is still used.
2. `apps/mobile/src/components/chat/voice-playback-source.ts:34-42`: `resolvePlaySource`, a Promise wrapper. `voice-message.tsx:342` calls `resolvePlaySourceEffect` directly.
3. `packages/chat-core/src/gifs.ts:28-30`: `resetGifsAvailability`. Its only callers were tests deleted in T-2192.
4. `apps/mobile/src/store/test-support.ts:52-69`: `fakeApiWithMembers`, a test helper no test uses.
5. `apps/mobile/src/test/wait.ts:83-89`: `waitForAct` and its comment, a test helper no test uses.

### Steps
1. Delete the five functions (and the comment right above `waitForAct`).
2. Then delete whatever in those files becomes unused because of it (a helper, an import, `pinKindFor` if nothing else calls it). Check each with `git grep -n "<name>" -- apps packages` first.
3. If `packages/chat-core/src/index.ts` names `resetGifsAvailability`, remove it there too.
4. Change nothing else.

### Allowed files
- `apps/mobile/src/lib/pin-snapshot.ts`
- `apps/mobile/src/components/chat/voice-playback-source.ts`
- `packages/chat-core/src/gifs.ts`
- `packages/chat-core/src/index.ts`
- `apps/mobile/src/store/test-support.ts`
- `apps/mobile/src/test/wait.ts`
- `work/T-2194-dead-leftovers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The diff only deletes lines.

---

## Report (written by the worker when done)

### What I did

- Deleted all five functions listed in the spec.
- `apps/mobile/src/lib/pin-snapshot.ts`: also deleted `pinKindFor` and its doc comment, which only `pinSnapshotText` called. Checked with `git grep -n "pinKindFor" -- apps packages`: the only other match is the unrelated local `pinKindFor` in `packages/client-core/src/store/pins.ts`. `SnapshotPinKind`, `PIN_KIND_LABEL` and `pinLabel` remain and are still used by `pinned-banner.tsx` and `pins-sheet.tsx`.
- `apps/mobile/src/components/chat/voice-playback-source.ts`: removed only `resolvePlaySource`; the `Effect` import is still used by `resolved` and `resolvePlaySourceEffect`.
- `packages/chat-core/src/gifs.ts`: removed `resetGifsAvailability`. `packages/chat-core/src/index.ts` re-exports the module with `export * from './gifs';`, so it needed no edit.
- `apps/mobile/src/store/test-support.ts`: removed `fakeApiWithMembers`; `fakeApi`, `fakeAppState` and the `ChatEntry` import are still used by the store tests.
- `apps/mobile/src/test/wait.ts`: removed `waitForAct` and the comment above it.
- No other change. `git diff --numstat -- apps packages`: 0 added, 76 deleted across 5 files.

### Commands run

- `pnpm install`: done in 14.5s.
- `git grep` for every deleted name before deleting: no callers outside the definitions (and for `pinKindFor`, only the unrelated client-core function).
- `pnpm gate` from the repo root:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (1.3s)
PASS  lint  (1.6s)
PASS  typecheck  (5.1s)
PASS  effect  (1.1s)
PASS  build @zilar/server  (0.9s)
PASS  tests @zilar/chat-core  (2.3s)
PASS  tests @zilar/mobile  (7.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

I ran no other test file separately; `pnpm gate` ran the chat-core and mobile suites.

### Problems / deviations

- None. The spec said step 3 only if `index.ts` names `resetGifsAvailability`; it re-exports the module wholesale, so no edit was needed there.
- The six changed files the gate counts are the five source files plus this task file.

### Open questions

- None.

### Security checklist

- No secrets, routes, queries, permissions or audit entries were touched; this task only deletes unused code.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). The diff only deletes lines: −76, of which 28 are test helpers.

Gone:
- `pinSnapshotText` and its now-unused `pinKindFor`;
- `resolvePlaySource`;
- `resetGifsAvailability`;
- `fakeApiWithMembers`;
- `waitForAct`.

Nothing called any of them.
