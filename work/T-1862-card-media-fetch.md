---
id: T-1862
title: "Media cards M3a: card-media/fetch.ts — fetch an https image or file through guardedGet (any public host, type allowlist, 8/25 MiB caps), sniff the bytes (PNG/JPEG/WebP; PDF/CSV/plain text), refuse oversized pixels, strip image metadata, store with storeCardMedia; returns the id + display metadata or a short refusal"
status: merged
milestone: M5
branch: task/T-1862-card-media-fetch
model: auto
effort: default
depends_on: [T-1847]
estimate: 45 min
---

# T-1862: Fetch, check and store one card media file (media plan M3, part a)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/message-blocks-media.md` (2026-10-17).** M1 (store) and M2 (read route) are merged.
- **This task builds the server function** the `fetch_media` model tool will call. The tool plumbing is the next task.
- **It's the security edge** (SSRF, active content, EXIF/GPS leaks), so it gets one test.

### Facts (read by the lead on 2026-10-17)
- **`guardedGet(rawUrl, options)`** (`apps/server/src/web-tools/guarded-fetch.ts:149`) resolves to `{ ok: true, body: { status, contentType, bytes, … } } | { ok: false, summary }`. `summary` is fixed wording.
  - **The options** (`:63-91`):
    - `allowedHosts`;
    - `anyPublicHost` (keeps https-only, port 443, no credentials, no redirects, the DNS pin, and the private/loopback/link-local refusal);
    - `resolver` (an injectable DNS lookup, for tests);
    - `maxResponseBytes`;
    - `allowedContentTypes` (replaces the default text list);
    - `fetcher` (injectable).
- **Magic bytes:** `isPng(bytes)` and `isWebp(bytes)` are exported from `apps/server/src/stickers/image.ts:115-123`.
- **The store** (`apps/server/src/card-media/service.ts`, T-1847):
  - `storeCardMedia(db, dir, { aiId, roomJid, groupId?, topicId?, mime, name, width?, height?, bytes })` returns the row, or fails with `CardMediaQuotaError` (40 per AI per day, 200 MiB total);
  - `CARD_MEDIA_DAILY_MAX`.
- **The plan's rules** (`docs/plan/message-blocks-media.md` §2.1 steps 1-4 and §4):
  - **an image** is at most 8 MiB, at most 4096 px a side and at most 16 MP, checked from the header without decoding;
  - **a file** is at most 25 MiB;
  - **the sniffed type is stored,** never the declared one;
  - **SVG, HTML and JavaScript are refused;**
  - **strip before writing:**
    - JPEG: drop `APPn` segments except `APP0` (JFIF) and `APP2` (ICC);
    - PNG: drop `eXIf`, `tEXt`, `zTXt` and `iTXt` chunks;
    - WebP: drop `EXIF` and `XMP ` chunks and fix the RIFF size;
  - **a format that can't be stripped is refused;**
  - **no source URL is stored.**

### Steps
1. **New `apps/server/src/card-media/sniff.ts`:** `sniffImage(bytes)` → `{ mime: 'image/png' | 'image/jpeg' | 'image/webp', width, height } | null`.
   - **PNG:** IHDR. **JPEG:** the first SOFn. **WebP:** VP8, VP8L or VP8X.
   - **`sniffFile(bytes)`** → `'application/pdf' | 'text/csv' | 'text/plain' | null`:
     - PDF by `%PDF-`;
     - text = valid UTF-8 with no NUL byte. It's CSV when the name ends `.csv`, else plain text, so pass the name in.
2. **New `apps/server/src/card-media/strip.ts`:** `stripImageMetadata(bytes, mime)` → the cleaned bytes, or `null` when the structure can't be walked. The rules are above.
3. **New `apps/server/src/card-media/fetch.ts`:** `fetchCardMedia(deps, input)`.
   - **`deps`** is `{ db, dir, resolver?, fetcher? }`.
   - **`input`** is `{ aiId, roomJid, groupId?, topicId?, url, kind: 'image' | 'file', name? }`.
   - **It returns** `{ ok: true, media: { id, mime, size, width?, height?, name } } | { ok: false, reason }`. Every `reason` is a short fixed sentence that never echoes the URL or remote text.
   - **The steps:**
     1. the URL must start with `https://` and be at most 2048 chars;
     2. `guardedGet` with `allowedHosts: []`, `anyPublicHost: true`, the allowlist for the kind (`image/png`, `image/jpeg`, `image/webp`; or `application/pdf`, `text/csv`, `text/plain`) and the kind's byte cap;
     3. sniff, then the pixel limits for an image;
     4. strip an image;
     5. `storeCardMedia`. A `CardMediaQuotaError` → "media quota reached".
   - **The name:** `input.name` trimmed to 100 chars, else the URL path's last segment sanitised to `[A-Za-z0-9._ -]`, else `image`/`file`.
4. **Test (security):** one test file, `apps/server/src/card-media/fetch.test.ts`, with an injected `resolver`/`fetcher`. No network.
   - **Refused,** with nothing stored:
     - an `http://` URL;
     - a host resolving to `10.0.0.5`;
     - a body declared `image/png` whose bytes are HTML.
   - **Stored:** a tiny JPEG built in the test with an `APP1` Exif segment. The stored file has no `APP1` segment, and the row's mime is `image/jpeg`.
5. **Every source file stays at most 400 lines.** Don't add an image library.

### Allowed files
- `apps/server/src/card-media/sniff.ts`
- `apps/server/src/card-media/strip.ts`
- `apps/server/src/card-media/fetch.ts`
- `apps/server/src/card-media/fetch.test.ts`
- `work/T-1862-card-media-fetch.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/card-media/fetch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`fetchCardMedia`** stores only sniffed, allowlisted, size- and pixel-checked, metadata-stripped bytes from a public https URL.
- **Every refusal** is a fixed sentence.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/card-media/sniff.ts`** — `sniffImage` reads dimensions from the header only: PNG IHDR, the first JPEG SOFn (marker walk, no decode), and WebP VP8/VP8L/VP8X. `sniffFile(bytes, name)` accepts `%PDF-` or valid UTF-8 with no NUL (`node:buffer.isUtf8`), labelled `text/csv` when the name ends `.csv`, else `text/plain`. SVG, HTML and JavaScript have no matching magic and return `null`.
- **`apps/server/src/card-media/strip.ts`** — `stripImageMetadata` walks each container and returns `null` when the structure cannot be followed:
  - JPEG drops every `APPn` except `APP0` (JFIF) and `APP2` (ICC); everything from SOS on is copied verbatim.
  - PNG drops `eXIf`, `tEXt`, `zTXt`, `iTXt`; chunk CRCs are copied untouched.
  - WebP drops `EXIF` and `XMP ` chunks, clears their bits in the VP8X flags, and rewrites the RIFF size. Pixels are never re-encoded and no decoder dependency was added.
- **`apps/server/src/card-media/fetch.ts`** — `fetchCardMedia(deps, input)` with the spec's steps: URL length/protocol check, `guardedGet` (`allowedHosts: []`, `anyPublicHost: true`, per-kind content-type allowlist, 8 MiB / 25 MiB cap), sniff, pixel check (4096 a side, 16 MP), strip, `storeCardMedia`. Returns `{ ok: true, media: { id, mime, size, width?, height?, name } }` or `{ ok: false, reason }`. Reasons are fixed sentences and never contain the URL, host or remote text; a `CardMediaQuotaError` maps to `media quota reached`. The display name is the trimmed/capped `input.name`, else the sanitised last URL segment, else `image`/`file`. It follows the Effect pattern (Effect inside, `Effect.runPromise` once at the exported function), so the gate's effect ratchet stays green.
- **`apps/server/src/card-media/fetch.test.ts`** — 4 tests with an injected resolver and fetcher, no network and no real keys: `http://` refused before the transport runs, a host resolving to `10.0.0.5` refused, HTML bytes declared `image/png` refused, and a JPEG built in the test with an `APP1` Exif segment stored with no `APP1` segment and row mime `image/jpeg` (16×16, name from the URL). Every refusal also asserts zero `card_media` rows and an empty storage directory.

Deviations / choices worth naming:
- The byte cap is enforced by `guardedGet` (`maxResponseBytes`) and re-checked on `body.bytes` before sniffing, so an injected transport cannot overshoot it.
- `strip.ts` additionally clears the EXIF/XMP flags in WebP's VP8X header after dropping those chunks; the spec asked for the chunk drop and RIFF size fix, and leaving the flags set would advertise missing chunks.
- All four source files are under 400 lines (202/216/215/188), and nothing outside the Allowed files was touched.

### Checks run

- `pnpm install` — clean (part of the first gate run and the second).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/card-media/fetch.test.ts` — **1 file passed, 4 tests passed** (twice: before the Effect conversion and after; same result).
- `pnpm gate` (from the repo root) — **GATE PASS**:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (3.0s)
  PASS  format  (1.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/server  (7.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed only on formatting; I ran Prettier on the four new files (allowed scope) and the rerun passed. The first run after formatting also flagged the effect ratchet; I moved `fetch.ts` onto Effect and replaced the `TextDecoder` try/catch in `sniff.ts` with `node:buffer.isUtf8`, after which the effect check passed.

### Notes for the lead

- No open questions. The tool plumbing and the `post_blocks` integration are the next task, as the spec says; this module only returns the id and display metadata.
- The refusal wording is mine, since the spec fixes only `media quota reached`; all sentences are short and static. If you want a specific set of strings for the model tool, they are constants at the top of `fetch.ts`.
- The test's JPEG is a minimal structural fixture (SOI, APP1 Exif, SOF0, SOS, entropy bytes, EOI); it is not a decodable photo by design, only a header/structure check.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `676bd42a3` (clean, 2 nits).
- **The guard:** `guardedGet` runs with `allowedHosts: []` and `anyPublicHost: true`, plus the per-kind type allowlist and byte cap.
- **The pixel limits:** 4096 a side and 16 MP, checked from the header.
- **The JPEG stripper** drops every APPn segment except APP0 and APP2, and copies everything from SOS on verbatim.
- **The test** covers http, a private address, HTML declared as a PNG, and the APP1 removal.
- **For the M3b tool task (nit 2):** a non-quota `storeCardMedia` failure rejects instead of returning `{ ok: false }`, so the tool wrapper must catch it and answer a fixed refusal.
- **Nit 1 is left as it is:** the oversize mapping compares guarded-fetch's literal wording.

