---
id: T-1567
title: "Sticker conversion failures log through pino: createStickerConverter takes an optional warn callback threaded to its helpers; the app wires it to base.logger.warn (structured, stderr tail only); defaultConverter keeps console.warn as the fallback"
status: merged
milestone: M5
branch: task/T-1567-sticker-convert-logs-pino
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1567: Sticker conversion logs through pino

## Spec (written by Claude, do not edit)

### Why
When ffmpeg or ffprobe fails on a sticker upload, the server writes `console.warn('[stickers] …')`. That line skips the pino JSON log the deploy checks read (level 40 and 50), so a failing conversion on the live server is invisible. This is a small follow-up from the 10-15 list.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/stickers/convert.ts` (283 lines):**
  - `logConvertFailure(summary, stderr)` (`:113-116`) does `console.warn(\`[stickers] ${summary}: ${stderr tail 300}\`)`;
  - it is called from `runOrFail` (`:156`, at `:166` and `:172`), `probeVideo` (`:178`, at `:188`) and `convertWithFfmpeg` (`:208`, at `:248`), all module-level;
  - `StickerConverterPaths { ffmpeg?, ffprobe? }` (`:73-76`);
  - `createStickerConverter(paths = {})` (`:260`) calls `probeVideo` and `convertWithFfmpeg`;
  - `export const defaultConverter = createStickerConverter()` (`:283`).
- **`StickersServiceDeps.converter?: StickerConverter`** (`apps/server/src/stickers/schemas.ts:59-60`). `storage.ts:224` and `telegram-store.ts:38` use `deps.converter ?? defaultConverter`.
- **`apps/server/src/app/routes-media.ts:26-35`** builds `stickersDeps = { ...base, storageDir, audit, getBotToken, … }` with no converter. `base.logger` is the pino `Logger` (`apps/server/src/app/deps.ts:166-170`).

### Steps
1. **`convert.ts`:**
   - `StickerConverterPaths` gains `warn?: (summary: string, stderrTail: string) => void`;
   - `logConvertFailure` takes the `warn` (or a small `log` param) and calls it, and falls back to today's `console.warn` line when it is absent;
   - thread it as a parameter into `runOrFail`, `probeVideo` and `convertWithFfmpeg` from `createStickerConverter`;
   - never log the file's bytes, and keep the 300-character stderr tail.
2. **`routes-media.ts`:** `stickersDeps` gains `converter: createStickerConverter({ warn: (summary, tail) => base.logger.warn({ stderrTail: tail }, \`sticker conversion failed: ${summary}\`) })`.
3. **No other behaviour change:** the same errors, statuses and texts.

### Tests
None (logging only).

### Allowed files
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/app/routes-media.ts`
- `apps/server/src/stickers/routes.ts` (added by the lead in fix round 1)
- `apps/server/src/stickers/api-handlers.ts` (added by the lead in fix round 1)
- `work/T-1567-sticker-convert-logs-pino.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n "console.warn" -- apps/server/src/stickers` shows only the fallback inside `logConvertFailure`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
Threaded an optional `warn` callback through the sticker converter so conversion
failures reach the pino server log instead of `console.warn`.

- `apps/server/src/stickers/convert.ts`: added `StickerConvertWarn` and
  `warn?: StickerConvertWarn` on `StickerConverterPaths`; `logConvertFailure` now
  takes the `warn` first and calls it with the summary and 300-char stderr tail,
  falling back to the existing `console.warn` line when absent; threaded `warn`
  through `runOrFail`, `probeVideo` and `convertWithFfmpeg` from
  `createStickerConverter`. Still never logs the file's bytes.
- `apps/server/src/app/routes-media.ts`: `stickersDeps` now sets
  `converter: createStickerConverter({ warn: (summary, stderrTail) =>
  base.logger.warn({ stderrTail }, \`sticker conversion failed: ${summary}\`) })`.
- No behaviour change beyond logging: same errors, statuses and texts.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/pack-link.test.ts`
  → 1 file passed, 6 tests passed.
- `git grep -n "console.warn" -- apps/server/src/stickers` → one line, the
  fallback in `logConvertFailure` (`convert.ts:124`).
- `pnpm gate` → `GATE PASS`:
  ```
  install (frozen) PASS / format PASS / lint PASS / typecheck PASS / effect PASS /
  tests @zilar/server PASS
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- First gate run failed on `format` (long `logConvertFailure` signature); ran
  `prettier --write` on `convert.ts` and the second gate passed.

### Notes for the lead
- Files changed: `apps/server/src/stickers/convert.ts`,
  `apps/server/src/app/routes-media.ts`, this task file.
- No tests added (logging only), per the spec.
- `defaultConverter` still uses the `console.warn` fallback.
- No deviations from the spec.
- Fix round 1 (lead): `StickersRoutesDependencies` gained `converter?: StickerConverter` and `serviceDeps()` in `api-handlers.ts` now forwards `deps.converter`, so the pino `warn` wired in `routes-media.ts` actually reaches `storage.ts`/`telegram-store.ts` (it was dropped before); `pnpm gate` still `GATE PASS`.

## Review (written by Claude)

**Approved and merged after one fix round.**

- **First packet:** clean. Its follow-up found that the change did nothing: `serviceDeps()` (`api-handlers.ts:75-81`) rebuilt the service deps without the converter. The lead's spec had missed that step. The lead added `routes.ts` and `api-handlers.ts` to Allowed files and sent the fix.
- **Second packet:** clean.
- **What the lead checked:**
  - **Wiring:** the `routes-media.ts` converter → `StickersRoutesDependencies.converter` → `serviceDeps()`, which `importDeps()` spreads, so both the upload and the Telegram import use it.
  - **Fallback only:** `console.warn` remains only as the fallback inside `logConvertFailure`, for `defaultConverter`.
  - **Concurrency:** the conversion slot limit stays module-level and shared.
- **Live:** the next deploy check should show no `[stickers]` console lines. A failing conversion would now appear as a pino level-40 line, "sticker conversion failed: …".
