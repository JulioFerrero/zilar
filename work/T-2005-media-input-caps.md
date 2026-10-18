---
id: T-2005
title: "Media hardening: sticker uploads and the Telegram import read capped bodies; voice transcription reads at most 10 MB and keys its cache without the query string; ffprobe/ffmpeg only read local files; the card JPEG stripper drops everything after the image data — with tests"
status: merged
milestone: M5
branch: task/T-2005-media-input-caps
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2005: Caps and clean-up on media inputs

## Spec (written by Claude, do not edit)

### Why
The lead's private security reviews of 2026-10-18 (T-1986, T-1987) found four gaps in how the server reads media:
- **Sticker uploads.** The size check uses only the declared `Content-Length`. A chunked body skips it and is buffered whole. The Telegram import body is read with no cap.
- **Voice transcription.** It buffers the whole upload (ejabberd allows 50 MB) before its 10 MB check. The cache key includes the query string, so `?1`, `?2`, … each call the paid provider again.
- **ffprobe and ffmpeg.** They run on uploaded bytes with no protocol whitelist, so a crafted playlist could make them fetch internal URLs.
- **The card JPEG stripper.** It copies everything after the first scan untouched, so trailing metadata (often GPS) survives.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Sticker upload.** `stickers/api-upload.ts` (104 lines), multipart branch (`:36-56`):
  - `const declared = Number(request.request.headers['content-length'] ?? '')`. A missing header gives `0`, and junk gives `NaN`; both pass the check.
  - It then calls `webRequest.formData()` and `file.arrayBuffer()`, and checks `STICKER_MAX_UPLOAD_BYTES` only after reading.
- **Telegram import.** In `stickers/api-handlers.ts` (294 lines), the import reads `request.request.text` with no cap (`:146`).
- **Capped reads.** `http/read-capped.ts` (43 lines) exports `readCapped(...)` (`:11`), which stops at a cap.
- **Voice upload.** `voice-transcription/pipeline.ts` (330 lines) does `await new Response(response.body).arrayBuffer()` (`:310`) before its size check.
- **Voice cache key.** In `voice-transcription/routes.ts` (189 lines):
  - `voiceTranscriptUrlHash(url)` hashes the raw URL (`:86-88`);
  - the internal fetch URL keeps `caller.search` (`:148`).
- **ffprobe and ffmpeg.** In `voice/engine.ts` (184 lines):
  - ffprobe runs `['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath]` (`:101-105`);
  - ffmpeg runs `['-nostdin', '-y', '-i', inputPath, ...]` (`:143-161`).
- **JPEG stripper.** In `card-media/strip.ts` (220 lines), at the first SOS marker (`0xda`) it pushes `bytes.subarray(start, bytes.length)` and returns (`:139-145`).

### Steps
1. **Sticker upload.** Refuse a multipart upload with no valid `Content-Length` (`411 length_required`), or one above the cap plus 64 KiB (`413`). Keep the after-read check.
2. **Telegram import.** Read the body with `readCapped`, with a cap of 64 KiB, before parsing.
3. **Voice transcription.**
   - Check `content-length` first.
   - Read the body with `readCapped` at 10 MB.
   - Drop the query string and fragment from both the cache key and the internal fetch URL.
4. **ffprobe and ffmpeg.** Add `-protocol_whitelist file,pipe` before `-i` (and before the input path for ffprobe).
5. **JPEG stripper.** After the first SOS, keep scanning:
   - keep the entropy-coded data, restart markers (`0xd0`–`0xd7`) and any later SOS segments (progressive JPEGs);
   - stop at the first EOI (`0xffd9`) and drop everything after it;
   - drop any APPn or COM segment that appears between scans.
6. **Tests.** Use the nearest existing test files. If none exists in a folder, add one next to the file.
   - a chunked sticker upload with no `Content-Length` answers 411;
   - two voice URLs that differ only by query string share one cache key;
   - a JPEG with an Exif block appended after EOI comes out without it;
   - a progressive JPEG still decodes after stripping (compare its dimensions with the sharp library already used in card-media, if it is there).
7. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/stickers/api-upload.ts`
- `apps/server/src/stickers/api-handlers.ts`
- `apps/server/src/stickers/api-upload.test.ts`
- `apps/server/src/voice-transcription/pipeline.ts`
- `apps/server/src/voice-transcription/routes.ts`
- `apps/server/src/voice-transcription/routes.test.ts`
- `apps/server/src/voice/engine.ts`
- `apps/server/src/card-media/strip.ts`
- `apps/server/src/card-media/strip.test.ts`
- `work/T-2005-media-input-caps.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/stickers src/voice-transcription src/voice src/card-media --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- **Sticker upload** (`stickers/api-upload.ts`): the multipart branch now requires a valid,
  non-negative `Content-Length`; a missing/junk/negative value answers 411
  `length_required` before any body read. A declared length above the cap plus
  64 KiB still answers 413, and the after-read 4 MiB check is unchanged. The raw
  branch is unchanged. The 411 is returned as a fixed `HttpServerResponse`
  envelope because `errors.ts`'s `HttpError` status union does not include 411
  and `errors.ts` is outside the Allowed files.
- **Telegram import** (`stickers/api-handlers.ts`): the body is read with
  `readCapped` at 64 KiB before JSON parsing; an over-cap body answers 413
  `request_too_large`.
- **Voice transcription** (`voice-transcription/pipeline.ts`): `defaultAudioFetcher`
  checks `content-length` first, then streams the body through `readCapped` at
  10 MB. An over-cap body is `VoiceTooLarge` (413) rather than `AudioUnavailable`
  (502), and `fetchAudioEffect` forwards it. `routes.ts` now builds both the
  cache key and the internal fetch URL from the upload path only, dropping the
  query string and fragment.
- **ffprobe/ffmpeg** (`voice/engine.ts`): both commands pass
  `-protocol_whitelist file,pipe` before the input.
- **JPEG stripper** (`card-media/strip.ts`): after the first SOS it scans the
  entropy-coded data, keeps stuffed bytes, restart markers and later SOS
  segments (progressive JPEGs), drops APPn/COM segments between scans, and stops
  at the first EOI so trailing blocks are dropped.
- **Tests added**: `stickers/api-upload.test.ts` (chunked multipart with no
  `Content-Length` → 411), `voice-transcription/routes.test.ts` (query/fragment
  share one cache key and the internal URL drops them),
  `card-media/strip.test.ts` (Exif after EOI dropped; progressive two-scan file
  keeps both scans and loses metadata between them; no EOI → null).

Files changed (all inside Allowed files):
`apps/server/src/stickers/api-upload.ts`,
`apps/server/src/stickers/api-handlers.ts`,
`apps/server/src/stickers/api-upload.test.ts`,
`apps/server/src/voice-transcription/pipeline.ts`,
`apps/server/src/voice-transcription/routes.ts`,
`apps/server/src/voice-transcription/routes.test.ts`,
`apps/server/src/voice/engine.ts`,
`apps/server/src/card-media/strip.ts`,
`apps/server/src/card-media/strip.test.ts`,
`work/T-2005-media-input-caps.md`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/api-upload.test.ts`:
  1 file passed, 1 test passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/card-media/strip.test.ts src/voice-transcription/routes.test.ts`:
  2 files passed, 8 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/stickers src/voice-transcription src/voice src/card-media --reporter=dot --maxWorkers=2`:
  7 files passed, 21 tests passed.
- `pnpm gate`: the first run failed only `format` on the two new test files; after
  `pnpm exec prettier --write` on those two files, the second run ended with:
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (16.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **411 status**: `ContentfulStatusCode` in `apps/server/src/errors.ts` has no
  411, and that file is not in Allowed files, so the 411 is a directly returned
  `HttpServerResponse.jsonUnsafe` with the standard `{ error: { code, message,
  requestId } }` shape. Moving it to `HttpError` would need 411 added to
  `errors.ts`.
- **Progressive JPEG decode**: the repo has no `sharp` (or any JPEG decoder), so
  the test cannot compare decoded dimensions. It instead asserts the stripped
  output keeps SOF2 and both SOS segments, keeps both entropy runs and ends at
  the first EOI, with APP1/COM removed. A real decode check would need a new
  dependency.
- **Voice fetch leg test coverage**: `defaultAudioFetcher` uses the module-level
  `defaultInternalFetch` with no injection point, so the new `content-length`
  and `readCapped` path is not exercised by a test; the cache-key and internal
  URL changes are tested directly. I did not add an injection seam because it
  was outside the spec.
- **Telegram import over-cap code**: the spec did not name a code, so I used
  `413 request_too_large` with the fixed message "The import body is too large".


## Review (written by Claude)

Approved: a clean pre-review with 2 nits and 1 follow-up.
- **Sticker upload:** answers 411 with no `Content-Length` and 413 when it is too large. The Telegram import body is capped.
- **Voice transcription:** reads with `readCapped` at 10 MB, and its cache key and fetch URL drop the query string.
- **Voice ffprobe/ffmpeg:** they get `-protocol_whitelist file,pipe`.
- **The JPEG stripper:** keeps the scans and stops at EOI.
- **Nit, `Content-Length`:** a garbage `Content-Length` such as `""` or `1e6` never reaches the handler, because Node's HTTP parser rejects any `Content-Length` that isn't plain digits.
- **Follow-up, T-2012:** `stickers/convert.ts` runs ffprobe/ffmpeg without the whitelist.
