---
id: T-2030
title: "Share W1-k: the attachment rules (50 MB cap, image MIME set without SVG, image-or-file classification, http(s)-only link check, octet-stream fallback) move into chat-core files.ts — web and phone keep their File/picker code and re-export the shared names — fewer lines, with tests"
status: merged
milestone: M5
branch: task/T-2030-shared-attachment-rules
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2030: Shared attachment rules (share plan W1-k)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` §2.19 and slice **W1-k** found the attachment rules written twice:
- the 50 MB cap;
- the image MIME set without SVG;
- classification;
- the http(s) check;
- the `application/octet-stream` fallback.

The SVG rule is a security rule: an SVG can carry script, so it must never render as an image. Tests are required.

### Facts (read by the lead on 2026-10-18 at `bb0a94a8a`)
- **Web.** `apps/web/src/lib/attachments.ts` (224 lines):
  - `MAX_ATTACHMENT_BYTES` (`:7`);
  - `IMAGE_MIME_TYPES` with png, jpeg, gif and webp (`:10-15`);
  - `classify(file: File)` (`:41-43`) checks `file.type`, case-sensitive;
  - `safeHttpUrl` (`:46-51`).
- **Phone.** `apps/mobile/src/lib/attachments.ts` (226 lines):
  - the same cap (`:25`) and MIME set (`:28-33`);
  - `classifyMobileFile` (`:60-63`) **lowercases** the MIME;
  - `safeHttpUrl` (`:66-72`);
  - the octet-stream fallback in `attachmentDataFor` (`:92-95`).
- **The existing test.** `apps/mobile/src/lib/attachments.test.ts` is 32 lines.
- **The shared home.** `packages/chat-core/src/files.ts` (43 lines) is already exported by the chat-core barrel (`packages/chat-core/src/index.ts:29`). **Put the shared rules in this file, so the barrel doesn't change.**
- **Importers** use the app modules, for example `@/lib/attachments` in mobile `attachment-message.tsx`, `chat-thread.tsx`, `composer-media.ts`, `composer-picked-strip.tsx`, `attachment-opener.ts` and `attachment-picker.ts`. **Keep every exported name in both app modules**, so no importer changes.

### Steps
1. **The shared rules.** Add to `packages/chat-core/src/files.ts`:
   - `MAX_ATTACHMENT_BYTES`;
   - `classifyMime(mime: string | undefined): 'image' | 'file'`, which lowercases first, has no SVG, and treats an empty or unknown type as a file;
   - `safeHttpUrl(url)`;
   - `mimeOrOctetStream(mime: string | undefined): string`.

   Keep comments short. `files.ts` must stay at or under 400 lines.
2. **Web.** `apps/web/src/lib/attachments.ts` re-exports `MAX_ATTACHMENT_BYTES` and `safeHttpUrl` from `@zilar/chat-core`. `classify(file)` becomes `classifyMime(file.type)`. Use `mimeOrOctetStream` where web falls back to octet-stream (around `:181`). Delete the local set and copies.
3. **Phone.** `apps/mobile/src/lib/attachments.ts` does the same:
   - `classifyMobileFile(file)` becomes `classifyMime(file.mimeType)`;
   - `attachmentDataFor` uses `mimeOrOctetStream`.

   Keep the exported names.
4. **Tests.** Move the rule cases from `apps/mobile/src/lib/attachments.test.ts` into `packages/chat-core/src/files.test.ts`; create it if it doesn't exist. Cover:
   - `image/svg+xml` is a file;
   - `IMAGE/PNG` is an image;
   - an empty MIME is a file;
   - `javascript:` and `data:` give `undefined`, and `https:` passes;
   - octet-stream is used for an empty MIME.

   Delete the mobile test file if nothing is left in it.
5. **Fewer lines.** Product lines across `files.ts` and the two app modules must go down, against 491 today (43 + 224 + 224 of non-test code; count the real numbers). Put the before and after counts in the Report.

### Allowed files
- `packages/chat-core/src/files.ts`
- `packages/chat-core/src/files.test.ts`
- `apps/web/src/lib/attachments.ts`
- `apps/mobile/src/lib/attachments.ts`
- `apps/mobile/src/lib/attachments.test.ts`
- `work/T-2030-shared-attachment-rules.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/files.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did

Moved the attachment rules into `packages/chat-core/src/files.ts`:

- `MAX_ATTACHMENT_BYTES` (50 MB), `classifyMime` (lowercases first; png/jpeg/gif/webp only, so SVG, empty and unknown types are files), `safeHttpUrl` (http(s) only) and `mimeOrOctetStream`.
- Web `apps/web/src/lib/attachments.ts` re-exports `MAX_ATTACHMENT_BYTES` and `safeHttpUrl`; `classify(file)` is now `classifyMime(file.type)`; the upload `contentType` uses `mimeOrOctetStream`. Removed the local cap, MIME set, `safeHttpUrl` and inline fallback.
- Mobile `apps/mobile/src/lib/attachments.ts` re-exports `MAX_ATTACHMENT_BYTES` and `safeHttpUrl`; `classifyMobileFile(file)` is now `classifyMime(file.mimeType)`; `attachmentDataFor` uses `mimeOrOctetStream`; the exported `mimeForAsset` is now an alias of `mimeOrOctetStream`. Removed the local cap, MIME set, `safeHttpUrl` and inline fallback.
- Every exported name in both app modules is kept, so no importer changed.

Files changed (all inside Allowed files):

- `packages/chat-core/src/files.ts`
- `packages/chat-core/src/files.test.ts`
- `apps/web/src/lib/attachments.ts`
- `apps/mobile/src/lib/attachments.ts`
- `work/T-2030-shared-attachment-rules.md`

Tests added to `packages/chat-core/src/files.test.ts`: four raster types are images; `IMAGE/PNG` is an image; `image/svg+xml` is a file (plain and upper-case); empty/undefined/PDF MIME is a file; `http:`/`https:` pass `safeHttpUrl`; `javascript:`, `data:`, relative, malformed and `file:` are rejected; `mimeOrOctetStream` falls back for empty/undefined and keeps a reported MIME.

The existing `apps/mobile/src/lib/attachments.test.ts` had no rule cases (it only tested `imageAttachmentRender`, which stays in the mobile module), so nothing was moved out of it and the file was kept. The rule cases now live in `files.test.ts`.

Product line counts (non-test, `wc -l`):

| File | Before | After |
| --- | --- | --- |
| `packages/chat-core/src/files.ts` | 43 | 73 |
| `apps/web/src/lib/attachments.ts` | 224 | 209 |
| `apps/mobile/src/lib/attachments.ts` | 226 | 208 |
| **Total** | **493** (real; spec said 491) | **490** |

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/files.test.ts`: 1 file passed, 17 tests passed.
- `pnpm gate` from the repo root (first run): failed typecheck, `apps/web/src/lib/attachments.ts(160,19): error TS2304: Cannot find name 'MAX_ATTACHMENT_BYTES'` — a re-export does not bind the name locally; fixed by importing it too.
- `pnpm gate` (second run): ended with `GATE PASS`; summary lines:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/chat-core
  PASS  tests @zilar/mobile
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Deviation: web's `classify` was case-sensitive and is now case-insensitive through the shared `classifyMime` (as the spec requires: `IMAGE/PNG` is an image). Mobile already lowercased, so this only widens web.
- Real pre-change total is 493, not 491 (mobile was 226 lines, not 224). The after total is 490, so product lines are down against both numbers.
- `mimeForAsset` (used by `attachment-picker.ts`) is now `export const mimeForAsset = mimeOrOctetStream;`, keeping the exported name and behavior with no importer change.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** The rules now live in chat-core `files.ts`: `MAX_ATTACHMENT_BYTES`, `classifyMime` (lowercased, SVG never an image), `safeHttpUrl` and `mimeOrOctetStream`.
- **Behaviour.** Both apps keep their exported names. Web's classification now lowercases the MIME as the phone already did.
- **Size.** Product lines went from 493 to 490. The value is the one tested SVG and link rule.
