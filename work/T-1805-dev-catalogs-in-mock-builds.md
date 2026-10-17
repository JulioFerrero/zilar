---
id: T-1805
title: "Phone dev catalogs (dev/blocks, dev/topic-header, dev/kit) also render in mock builds (EXPO_PUBLIC_ZILAR_MOCK), so the lead's emulator smoke can screenshot them; release builds still redirect home"
status: merged
milestone: M5
branch: task/T-1805-dev-catalogs-in-mock-builds
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1805: Dev catalogs in mock builds

## Spec (written by Claude, do not edit)

### Why
The lead checks phone UI on the emulator with `ZILAR_SMOKE_MOCK=1 pnpm phone:smoke <branch>`, which builds a **release-mode mock build**. The dev catalog routes render only behind `__DEV__`, so in that build they redirect home. On 2026-10-17 the smoke for `/dev/blocks` and `/dev/topic-header` screenshotted the chat list instead of the catalogs. The phone cards and topic screens have never been seen on the emulator.

### Facts (read by the lead on 2026-10-17)
- **The routes:** `apps/mobile/src/app/dev/blocks.tsx:9-18`, `apps/mobile/src/app/dev/topic-header.tsx:11` and `apps/mobile/src/app/dev/kit.tsx:10` each do `if (__DEV__) { require('@/mock/dev-…-screen') … return <Screen /> } return <Redirect href="/" />`.
- **The pattern** for a mock-only module that stays out of production bundles is `apps/mobile/src/app/settings/devices.tsx:52-57`: `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) { require(...) }`. Metro inlines the env var at bundle time, so a normal release build folds it to `false`.
- **The smoke:** `scripts/phone/smoke.sh:40-42` sets `ZILAR_MOCK=1` for a mock build, and `:59` opens routes with `am start … -d "zilar:/${route}"`.

### Steps
1. In the three routes, change `if (__DEV__)` to `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`, keeping the literal condition so Metro still folds it. Update each header comment to name both conditions.
2. Leave `apps/mobile/src/app/dev/whistle.tsx` as it is (it has no `__DEV__` gate).
3. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/app/dev/blocks.tsx`
- `apps/mobile/src/app/dev/topic-header.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `work/T-1805-dev-catalogs-in-mock-builds.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A mock build opens `zilar://dev/blocks`, `zilar://dev/topic-header` and `zilar://dev/kit` to their catalogs.
- A release build without the mock env still redirects home.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Changed the gate in `apps/mobile/src/app/dev/blocks.tsx`, `app/dev/topic-header.tsx` and
  `app/dev/kit.tsx` from `if (__DEV__)` to
  `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`. The condition stays literal so
  Metro still folds it at bundle time.
- Updated each header comment to name both conditions and to say that a normal release
  build folds the condition to false and still redirects home.
- Left `apps/mobile/src/app/dev/whistle.tsx` untouched, as the spec says.
- Added a one-line `// effect-plain:` marker to each of the three changed files. The
  gate's Effect ratchet flags the new `process.env` signal as "needs Effect"; the marker
  is the repo's established way of recording that a file is presentational with no I/O or
  ports (used across `apps/web`). No Effect import was added. This is the only addition
  beyond the literal spec.
- No tests, per the spec. Files are 20 lines each, well under 400.

Files changed: the three routes above and this task file.

### Checks run

- `pnpm install` — clean, no output.
- `pnpm gate` — `GATE PASS`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.7s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests, and the gate skipped
  `@zilar/mobile` for lack of nearby test files.

### Notes for the lead

- I did not run the emulator smoke (no device here). I verified the acceptance statically:
  `scripts/phone/smoke.sh:42` sets `ZILAR_MOCK=1`, and `scripts/phone/install.sh:20,29,60,70`
  passes `EXPO_PUBLIC_ZILAR_MOCK="$MOCK_FLAG"` into the release build — `1` for a mock
  build, empty otherwise. A mock build therefore inlines a truthy flag and opens the
  catalog; a normal release build inlines an empty/falsy value and redirects home.
- Worth a smoke with `ZILAR_ROUTES="/dev/blocks /dev/topic-header /dev/kit"` to see the
  three catalogs on the emulator.
- The Effect ratchet needs the `effect-plain` marker on any changed file that reads
  `process.env`; without it `pnpm gate` fails at the `effect` step.

## Review (written by Claude)

Merged. The packet matches HEAD `fb61b73c3`. The three dev routes now gate on `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`, the same build-time literal as `settings/devices.tsx:57`, so a normal release build still folds to the redirect. The proof comes on the next mock smoke of `/dev/blocks` and `/dev/topic-header`.
