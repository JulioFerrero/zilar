---
id: T-1362
title: "Lead tool: add OpenCode Go's Muse (opencode-go/muse-spark-1.3-contributor) to the fallback chain before the paid Meta Muse — workers: Go DeepSeek → DeepSeek API → Go Muse → paid Muse; reviews and doctor: free Muse → Go Muse → paid Muse"
status: merged
milestone: M5
branch: task/T-1362-go-muse-fallback
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1362: Go Muse in the fallback chain

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "lets use opencode go if we can". The OpenCode Go plan he already pays for includes Muse Spark 1.3 Contributor (about 45,300 requests per 5 h). Today the fallbacks end on the metered Meta Muse. The lead checked that `opencode-go/muse-spark-1.3-contributor` is listed by `opencode2 models` and answers a prompt from this machine.

**Today's chain** (`packages/devtools/src/lead/fallback.ts:10-15`):
- Go DeepSeek → DeepSeek API → paid Muse;
- free Muse → paid Muse.

The reviews and the doctor start on the free Muse (`packages/devtools/src/lead/task-file.ts:85`, `start-prereview.ts:11`) and fall back with `fallbackModel(...)` (`decide.ts:221`, `doctor.ts:205`).

### What to build
1. **`packages/devtools/src/lead/models.ts`:** add `export const GO_MUSE = 'opencode-go/muse-spark-1.3-contributor';` with a one-line comment (T-1362, flat-rate Go listing).
2. **`packages/devtools/src/lead/fallback.ts` `fallbackModel`:**
   - `GO_DEEPSEEK_FLASH → DEEPSEEK_FLASH` (unchanged);
   - `DEEPSEEK_FLASH → GO_MUSE`;
   - `FREE_MUSE → GO_MUSE`;
   - `GO_MUSE → PAID_MUSE`;
   - anything else `undefined`.
   - Re-export `GO_MUSE` like the others, and update the comment.
3. **`packages/devtools/src/lead/decide.ts` `label()`:** `GO_MUSE` → `'Go Muse'`. Update the chain comment (`:113-115`).
4. **The model guard:** `assertAllowedModel` (`task-file.ts:62-69`) must accept `opencode-go/muse-spark-1.3-contributor`. It should already, since only `meta/` non-contributor ids are refused; confirm it and cite the line.
5. **`packages/devtools/src/lead/watch/format.ts`:** if it shortens model ids for display, make Go Muse readable (e.g. `muse (go)`), matching how Go DeepSeek shows.
6. **Tests:** update only the existing tests that assert the chain (search `fallbackModel` / `PAID_MUSE` in `packages/devtools/src/**/*.test.ts`). No new test files.
7. Every file stays at most 400 lines.

### Read first
`AGENTS.md` and the files above.

### Allowed files
`packages/devtools/src/lead/models.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/doctor.ts`, `packages/devtools/src/lead/task-file.ts`, `packages/devtools/src/lead/model-schedule.ts`, `packages/devtools/src/lead/watch/format.ts`, `packages/devtools/src/lead/*.test.ts`, `packages/devtools/src/lead/watch/*.test.ts`, `work/T-1362-go-muse-fallback.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `fallbackModel` returns the chain above (the updated tests show it).

---

## Report (written by the worker when done)

### What I did
Added the flat-rate OpenCode Go Muse to the fallback chain, before the metered
Meta Muse.

- `packages/devtools/src/lead/models.ts`: added
  `export const GO_MUSE = 'opencode-go/muse-spark-1.3-contributor';` with a
  comment (T-1362, flat-rate Go listing).
- `packages/devtools/src/lead/fallback.ts` `fallbackModel`: now
  `GO_DEEPSEEK_FLASH → DEEPSEEK_FLASH`, `DEEPSEEK_FLASH → GO_MUSE`,
  `FREE_MUSE → GO_MUSE`, `GO_MUSE → PAID_MUSE`, anything else `undefined`.
  `GO_MUSE` is imported and re-exported next to the other ids; the chain
  comment was rewritten.
- `packages/devtools/src/lead/decide.ts` `label()`: `GO_MUSE → 'Go Muse'`; the
  chain comment above it was updated; `GO_MUSE` was added to the
  `./fallback.js` import.
- `packages/devtools/src/lead/task-file.ts`: no change needed. Item 4 confirmed:
  `assertAllowedModel` (lines 62-69) calls `assertNotV4Pro` (matches only
  `v4.?pro`) and `isCostlyMetaModel` (lines 56-58, refuses only `/^meta\//`
  non-`-contributor` ids). `opencode-go/muse-spark-1.3-contributor` matches
  neither, so it is accepted as-is.
- `packages/devtools/src/lead/watch/format.ts` `modelLabel`: `GO_MUSE` now
  renders as `muse (go)` (with the effort appended as `muse (go) (low)` when a
  variant is passed), so it no longer reads the same as the metered
  `meta/muse-spark-1.3-contributor`.
- `packages/devtools/src/lead/model-schedule.test.ts`: updated the only
  existing chain assertions (import + `fallbackModel` cases). No new test
  files.
- `packages/devtools/src/lead/doctor.ts`: see the deviation note below.

All touched source files are ≤ 400 lines (largest: `decide.ts`, 337).

### Deviation from the spec (one, justified)
The spec only asked to update `label()`/comments for the escalation wording,
but the pre-review escalation in `decide.ts` and the doctor escalation in
`doctor.ts` hard-coded the sentence `continues on paid Muse`. With the new
chain a free-Muse quota error now moves to the Go Muse, so that sentence would
have been false. I changed `decide.ts` to use the existing `label(fallback)`
helper and made `doctor.ts` name the actual fallback (`Go Muse` / `paid Muse`)
via its own one-line conditional, and refreshed the doctor comment. Both files
are in the Allowed list. No test asserts these strings.

### Note on the watch badge (not changed, outside scope)
Item 5 names `packages/devtools/src/lead/watch/format.ts` (`modelLabel`), which
I updated. The `lead watch` UI, however, renders the badge from `modelBadge` in
`packages/devtools/src/lead/watch-format.ts` (a *different* file, not in the
Allowed list), which still shows every `*muse*` id as `Muse`. So the Go Muse is
now distinguishable in the `modelLabel` field of the view data but not yet in
the visible badge. I did not touch that file to stay inside scope; if the lead
wants the visible badge to read apart, `watch-format.ts:modelBadge` needs the
same treatment.

### Commands and real results
- `pnpm install`: done, 1133 packages, no errors.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts`:
  1 file passed, 8 tests passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts src/lead/merge.test.ts src/lead/session.test.ts`:
  3 files passed, 25 tests passed.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/devtools  (10.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Files changed
`packages/devtools/src/lead/models.ts`, `fallback.ts`, `decide.ts`,
`doctor.ts`, `watch/format.ts`, `model-schedule.test.ts`,
`work/T-1362-go-muse-fallback.md`.

### Open questions
Only the watch-badge note above; nothing blocking.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (1 nit, 1 follow-up); the packet is current for `9c64b067`.** The chain matches the spec. The autopilot picks it up on its next restart.
