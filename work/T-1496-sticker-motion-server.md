---
id: T-1496
title: "Moving stickers on the server (Julio, 2026-10-15): a GIF, WebM, MP4 or MOV upload is converted with ffmpeg to an animated WebP that loops (transparency kept, at most 3 s, 512x512, 512 KiB); animated WebP and APNG stay as they are"
status: merged
milestone: M5
branch: task/T-1496-sticker-motion-server
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1496: Moving stickers on the server

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-15 that stickers keep their motion. GIFs and short videos become animated WebP stickers that loop, like Telegram's video stickers. The design is in `docs/design/mockups/stickers/` (`WebNewPack.dc.html`, `README.md`), which arrives on the first Stickers branch. The rule: videos are up to 3 seconds.

The web and phone apps change in later tasks; they will send moving files untouched. This task is the server only.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/stickers/image.ts`** (311 lines):
  - `STICKER_MAX_BYTES = 512 * 1024` (`:8`) and `STICKER_MAX_DIMENSION = 512` (`:9`);
  - `probeStickerBytes` (`:278`) accepts PNG (APNG too) and WebP, static or animated, and rejects GIF and everything else (`:272-275`).
- **`apps/server/src/stickers/storage.ts`** (351 lines), `uploadSticker` (`:182-…`):
  - checks for an empty file (`:190`), then `> STICKER_MAX_BYTES` with 413 `sticker_too_large` (`:193-195`);
  - probes (`:196-199`), then inserts with `info.mime`, `width`, `height`, `bytes.byteLength`, and `storageKey = ${id}.${extensionFor(info.mime)}` (`:205-206`).
- **`apps/server/src/stickers/api-upload.ts`** (104 lines) caps the body at `STICKER_MAX_BYTES`:
  - multipart: declared length `> STICKER_MAX_BYTES + 64 * 1024` (`:38`), and the parsed file (`:53`);
  - raw: declared length (`:73`) and `readCapped(…, STICKER_MAX_BYTES)` (`:76`).
- **`StickersServiceDeps`** is at `apps/server/src/stickers/schemas.ts:49-56`; `serviceDeps()` is built at `apps/server/src/stickers/api-handlers.ts:74`.
- **`apps/server/src/voice/engine.ts`** (245 lines) already runs ffmpeg safely:
  - `runCommand` (`:76-121`) uses no shell, has a hard timeout, and SIGKILLs the child on timeout or interrupt;
  - `FfmpegError` is at `:56`;
  - the engine is injectable (`apps/server/src/app/deps.ts:41-42`, "tests inject a fake").
- **The server image** installs ffmpeg (`apps/server/Dockerfile:62`).
  - The live container has ffmpeg 8.0.1 with the `libwebp_anim` encoder and the `vp8`, `vp9`, `libvpx`, `libvpx-vp9`, `h264`, `hevc` and `gif` decoders (the lead checked on 2026-10-15).
  - **The Homebrew ffmpeg on Julio's Mac has no WebP encoder,** so conversion fails locally. That must be a clean 400, not a crash.
- **Clients map error codes by string** (e.g. `apps/mobile/src/components/stickers/pack-editor.ts:68` for `sticker_too_large`). There is no contract list of codes.

### What to build
1. **Share `runCommand`:** move `runCommand`, its `CommandResult` and `FfmpegError` from `apps/server/src/voice/engine.ts` into a new `apps/server/src/media/run-command.ts`, unchanged. `voice/engine.ts` imports them and re-exports `FfmpegError`, so its importers don't change.
2. **New `apps/server/src/stickers/convert.ts`:**
   - `convertibleKind(bytes): 'gif' | 'webm' | 'mp4' | null`, decided by magic bytes:
     - `GIF87a` or `GIF89a` is `gif`;
     - EBML `1A 45 DF A3` is `webm`;
     - `ftyp` at offset 4 is `mp4` (this covers MOV too).
   - `interface StickerConverter { toAnimatedWebp(bytes: Uint8Array, kind: …): Promise<Uint8Array> }`, and `createStickerConverter(paths?)`, the real one.
   - **The real converter:**
     1. writes the input into a fresh `mkdtemp` folder under `os.tmpdir()`, and always removes that folder in `finally`;
     2. runs `ffprobe` (JSON: `format=duration`, the first video stream's `codec_name`). No video stream answers 400 `sticker_unsupported`. **A duration over 3.05 s answers 400 `sticker_too_long`, "Videos are up to 3 seconds".**
     3. runs `ffmpeg -nostdin -y`, plus `-c:v libvpx-vp9` for VP9 or `-c:v libvpx` for VP8, placed **before** `-i` so the alpha channel is decoded; then `-i <in> -t 3 -an -vf "fps=30,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=yuva420p" -c:v libwebp_anim -loop 0 -lossless 0 -compression_level 4 -q:v <q> -f webp <out>`;
     4. tries `q` = 75, 60, 45, 30 and keeps the first output of at most `STICKER_MAX_BYTES`. If none fits: 413 `sticker_too_large`.
   - **Any ffmpeg or ffprobe failure, a missing encoder included,** answers 400 `sticker_convert_failed`, "This file could not be turned into a sticker". Log a warning with the exit code and the last 300 characters of stderr, and never the file's bytes.
   - **At most 2 conversions run at once** (a small semaphore in the module). The rest wait.
   - Timeouts: 10 s for ffprobe and 20 s for each ffmpeg run, through `runCommand`.
3. **`image.ts`:** add `STICKER_MAX_UPLOAD_BYTES = 4 * 1024 * 1024` next to `STICKER_MAX_BYTES`.
4. **`storage.ts` `uploadSticker`:**
   - after the empty check, reject `> STICKER_MAX_UPLOAD_BYTES` with 413 `sticker_too_large` ("The file is larger than 4 MiB");
   - if `convertibleKind(bytes)` is not null, replace `bytes` with `await deps.converter.toAnimatedWebp(bytes, kind)`;
   - then keep today's 512 KiB check and the probe, unchanged, so every stored file is still WebP or PNG.
5. **`api-upload.ts`:** the four caps (`:38`, `:53`, `:73`, `:76`) use `STICKER_MAX_UPLOAD_BYTES` (multipart keeps its `+ 64 * 1024`), and their message becomes "The file is larger than 4 MiB".
6. **`schemas.ts`:** `StickersServiceDeps` gains `converter?: StickerConverter`. `uploadSticker` uses `deps.converter ?? defaultConverter`, a module-level `createStickerConverter()` in `convert.ts`. No other wiring changes.
7. **No new tests.** This is not one of Julio's crucial areas. The gate must stay green, and **`storage.ts` must stay at most 400 lines.** If it would pass 400, move `uploadSticker` into a new `apps/server/src/stickers/upload.ts` and keep its export path working by re-exporting it from `storage.ts`.

### Allowed files
- `apps/server/src/media/run-command.ts`
- `apps/server/src/voice/engine.ts`
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/stickers/image.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/stickers/upload.ts`
- `apps/server/src/stickers/api-upload.ts`
- `apps/server/src/stickers/schemas.ts`
- `work/T-1496-sticker-motion-server.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Before merge, with Julio's OK, the lead runs the converter's exact ffprobe and ffmpeg arguments in the live server container** on a generated 2-second VP9-with-alpha WebM and on a GIF, both in the container's `/tmp`. The output must be an animated WebP of at most 512 KiB that keeps transparency.
- **After the deploy:** the upload route still answers 401 signed out, and the server logs show no new errors.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/media/run-command.ts`** (new): moved `runCommand`, `CommandResult` and `FfmpegError` out of `voice/engine.ts` unchanged (no shell, hard timeout, SIGKILL on timeout/interrupt). `voice/engine.ts` now imports them and re-exports `FfmpegError`, so its importers are untouched.
- **`apps/server/src/stickers/convert.ts`** (new, 272 lines): `convertibleKind` (GIF87a/89a, EBML `1A 45 DF A3` = webm, `ftyp` at offset 4 = mp4/MOV), the `StickerConverter` interface, and the real `createStickerConverter(paths?)`:
  - `mkdtemp` under `os.tmpdir()`, always removed in `finally`;
  - `ffprobe` (10 s) reads `format.duration` and the first video stream's `codec_name`; no video stream → 400 `sticker_unsupported`; duration > 3.05 s → 400 `sticker_too_long` ("Videos are up to 3 seconds");
  - `ffmpeg` (20 s each) with `-c:v libvpx-vp9` (vp9) / `-c:v libvpx` (vp8) before `-i`, then the exact `-t 3 -an -vf "fps=30,scale=512:512:...:flags=lanczos,format=yuva420p" -c:v libwebp_anim -loop 0 -lossless 0 -compression_level 4 -q:v <q> -f webp` from the spec;
  - tries q = 75, 60, 45, 30 and returns the first output of at most `STICKER_MAX_BYTES`; none fits → 413 `sticker_too_large`;
  - any ffmpeg/ffprobe failure (missing encoder included) → 400 `sticker_convert_failed` ("This file could not be turned into a sticker"), logging the exit code and the last 300 chars of stderr only (never bytes); this is `console.warn` because the converter is built module-level with no logger in `StickersServiceDeps`.
  - a module-level semaphore runs at most 2 conversions at once; the rest wait. Exports `defaultConverter = createStickerConverter()`.
- **`apps/server/src/stickers/image.ts`**: added `STICKER_MAX_UPLOAD_BYTES = 4 * 1024 * 1024` next to `STICKER_MAX_BYTES`.
- **`apps/server/src/stickers/storage.ts`** (359 lines, still < 400): after the empty check, rejects `> STICKER_MAX_UPLOAD_BYTES` with 413 `sticker_too_large` ("The file is larger than 4 MiB"); if `convertibleKind(bytes)` is not null, replaces `bytes` with `await (deps.converter ?? defaultConverter).toAnimatedWebp(bytes, kind)`; the 512 KiB check and the probe are unchanged.
- **`apps/server/src/stickers/api-upload.ts`**: the four caps use `STICKER_MAX_UPLOAD_BYTES` (multipart keeps `+ 64 * 1024`), all four messages now "The file is larger than 4 MiB".
- **`apps/server/src/stickers/schemas.ts`**: `StickersServiceDeps` gained `converter?: StickerConverter`. No wiring changes in `api-handlers.ts` (the fallback is the module-level default).

### Checks run

- `pnpm install`: done, 11.2 s (a pre-existing `@types/react` peer warning, unrelated).
- `pnpm exec prettier --write` on the 7 changed sources so the gate's format check passes.
- `pnpm gate` (from the repo root): `GATE PASS`.
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: no test sits next to any changed file (`apps/server` has no stickers/media/voice test for these, and no test anywhere references the sticker upload), so the gate skipped the server tests. Per the spec ("No new tests"), none were added.

### Notes for the lead

- I could not exercise the real conversion: `GATE` does not start ffmpeg and the local Homebrew ffmpeg has no WebP encoder. The acceptance step (running the exact ffprobe/ffmpeg args in the live container on a 2 s VP9-alpha WebM and a GIF) still needs to be done by the lead before merge. Locally, a missing encoder fails inside `runOrFail` and maps to a clean 400 `sticker_convert_failed`, not a crash.
- `sticker_unsupported` (probe found no video stream) reuses the fixed sentence "The file is not a supported sticker"; the spec fixed only the code, not the text.
- `convert.ts` is not re-exported through the `service.ts` barrel, since only `storage.ts` and `schemas.ts` need the type; add it to the barrel later if clients need it.
- What I did **not** touch: `telegram.ts` keeps its own 512 KiB cap on imported bytes (static Telegram stickers), outside this task's scope.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** the packet was clean (1 nit, 2 follow-ups) for head `22ee3cb24`.
- **The code follows the spec:**
  - `runCommand` moved unchanged to `media/run-command.ts`;
  - magic-byte detection; ffprobe then ffmpeg in a temp folder that is always removed;
  - VP8 and VP9 decode with libvpx, so alpha is kept;
  - the 3.05 s cap, quality steps 75, 60, 45, 30, the 4 MiB upload cap, and at most 2 conversions at once;
  - every stored file is still probed as WebP or PNG.
- **Live container check (Julio OK'd it, 2026-10-15),** with this task's exact arguments in the live server container (ffmpeg 8.0.1) on generated files in `/tmp`, removed afterwards:
  - a 2 s VP9 WebM with alpha became an animated WebP, VP8X flags `0x12` (alpha and animation), 30 frames, 445,764 bytes;
  - a 2 s GIF became 10 frames, 153,204 bytes, flags `0x12`.
  - Both are under 512 KiB at q 75.
- **Follow-ups, left for later:**
  - log conversion failures through pino instead of `console.warn`;
  - queued conversion waiters cannot be cancelled;
  - the duration check prefers the container's duration (the output is cut at 3 s anyway).
