---
id: T-1362
title: "Lead tool: add OpenCode Go's Muse (opencode-go/muse-spark-1.3-contributor) to the fallback chain before the paid Meta Muse — workers: Go DeepSeek → DeepSeek API → Go Muse → paid Muse; reviews and doctor: free Muse → Go Muse → paid Muse"
status: todo
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

## Review (written by Claude)
