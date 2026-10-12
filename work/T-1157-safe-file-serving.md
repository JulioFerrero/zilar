---
id: T-1157
title: "Security wave 2 (SEC-1, SEC-9): /api/files serves inline only an allowlist of safe media types (png/jpeg/gif/webp, mp4, audio/*); everything else, SVG included, is attachment; every reply gets CSP default-src 'none'; sandbox"
status: merged
milestone: M5
branch: task/T-1157-safe-file-serving
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1157: Safe file serving

## Spec (written by Claude, do not edit)

### Why
`docs/audit/security-audit.md` SEC-1 (P1) and fix **F1**.
- **The type comes from the sender:** `apps/server/src/files/api.ts` builds the reply headers from the upstream or row type (`:127-128`, `contentType = upstream.get('content-type') ?? row.mime ?? …`). It sets `content-disposition: attachment` only for some cases (`:145`), and it already sets `nosniff` (`:142`).
- **The danger:** a sender-declared "image" such as an `.svg` is served **inline on the app origin** with no CSP of its own, so script in it would run with the user's session.
- **The kind is the sender's word too:** it comes from the stanza payload (`apps/server/src/media/extract.ts:133-138`).
- **`/upload/*` headers at Caddy** are the separate task T-1156.

### What to build
1. **In `apps/server/src/files/api.ts`**, in the header builder:
   - **Inline only** when the effective content type is in an allowlist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `video/mp4`, `video/webm` and `audio/*`, including `audio/mp4` and `audio/mpeg` for voice. **Everything else** gets `content-disposition: attachment` with the existing filename encoding (`encodeRfc5987`).
   - **SVG** (`image/svg+xml`) and `text/html` are always attachment, and their content type is forced to `application/octet-stream`.
   - **Every reply** gets `content-security-policy: default-src 'none'; sandbox`.
   - Keep `nosniff` and the cache header. The file stays at most 400 lines.
2. **Clients:** check that the web and mobile image and video components still render the allowlisted types through `/api/files`. They should, because inline is kept for those; name the components in the Report. **Change no client code.**
3. **Tests** (permissions), in `apps/server/src/files/routes.test.ts`, following its `GET /api/files` setup (`:137`), at most 2:
   - an `image/svg+xml` row answers `attachment`, `application/octet-stream` and the CSP header;
   - an `image/png` row stays inline, with the CSP header.

### Read first
`AGENTS.md`, `docs/audit/security-audit.md` (SEC-1, F1), `apps/server/src/files/api.ts` and `apps/server/src/files/routes.test.ts:130-200`.

### Allowed files
`apps/server/src/files/api.ts`, `apps/server/src/files/routes.test.ts`, `work/T-1157-safe-file-serving.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/files/routes.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check on the live web:** a photo and a voice note in a chat still show and play.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/files/api.ts`: `passthroughHeaders` now serves inline only for
  `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `video/mp4`, `video/webm` and
  `audio/*` (exact match on the header-or-row mime before any `;` params,
  case-insensitive). `image/svg+xml` and `text/html` are always attachment and their
  content type is forced to `application/octet-stream`. Every reply gets
  `content-security-policy: default-src 'none'; sandbox`. Kept `nosniff`,
  `cache-control: private, max-age=3600`, and the existing `encodeRfc5987`
  attachment filename. File is 330 lines (limit 400). Note: with this change a
  `kind: 'file'` row is always attachment, and an `image`/`gif`/`voice` row is
  attachment unless its effective type is in the allowlist — so a mislabeled row
  (e.g. kind `image` with an SVG mime) is still forced to attachment.
- Client check, no code changed: web loads same-origin uploads through
  `GET /api/files` via `mediaSrc` (`apps/web/src/lib/attachments.ts:60-76`), used by
  `apps/web/src/components/ImageMessage.tsx` (`<img>`), `GifMessage.tsx`
  (`<video src>` mp4/webm), `VoiceMessage.tsx` (`<audio src>`, voice notes are
  audio/mp4 and audio/mpeg, both covered by `audio/*`), and `FileMessage.tsx`
  (download link, works with attachment). All allowlisted types stay inline, so
  photos and voice notes still render and play. Mobile has no `/api/files`
  consumer (grep for `/api/files` in `apps/mobile` returns nothing): mobile
  renders images with `AttachmentImage`/`AttachmentViewer` in
  `apps/mobile/src/components/chat/attachment-message.tsx` (expo-image against
  trusted-host direct URLs), video with `attachment-video.tsx` (expo-video), and
  voice with `voice-message.tsx`; unaffected by this change.
- `apps/server/src/files/routes.test.ts`: extended the `seedMediaItem` helper with
  optional `kind`/`mime` params (defaults keep all existing callers identical) and
  added the 2 spec tests: SVG row answers `attachment` + `application/octet-stream`
  + CSP; PNG row stays inline (no `content-disposition`) + CSP.

### Files changed
- `apps/server/src/files/api.ts`
- `apps/server/src/files/routes.test.ts`
- `work/T-1157-safe-file-serving.md` (this file)

### Commands and real results
- `pnpm install`: done, 22s (turbo/typescript/vitest version notices only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files/routes.test.ts`:
  1 file passed, 15 tests passed (13 existing + 2 new), 13.4s.
- `pnpm gate` (repo root): `gate: 3 changed file(s) against main` / PASS install
  (1.0s) / PASS format (1.2s) / PASS lint (0.8s) / PASS typecheck (3.0s) /
  PASS effect (0.6s) / PASS tests @zilar/server (14.4s) /
  `scope: every changed file is inside the Allowed files` / GATE PASS.

### Problems / deviations
- None. The existing PDF test (`serves a member the bytes...`) still passes: PDFs
  were already attachment via `kind: 'file'` and remain attachment.

### Security checklist
- No secrets/tokens in logs or code (headers carry only mime, cache, CSP, disposition).
- No DB writes in this change; permission checks untouched (404 behavior unchanged).
- New tests use injected `fetchImpl` and PGlite, no external services.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **Inline allowlist:** png, jpeg, gif and webp, mp4 and webm, `audio/*`. Anything else is an attachment.
- **SVG and HTML** are forced to `application/octet-stream` and served as attachments.
- **Every reply** gets `default-src 'none'; sandbox`, which doesn't affect `<img>`/`<video>` rendering in the app, plus `nosniff`, kept.
- **Tests:** the lead ran them in the branch: 15 of 15.
- **Still to do:** the live check (a photo and a voice note still show and play) after the deploy.
