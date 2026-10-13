---
id: T-1322
title: "Web files like Telegram (parity with T-1319): round-icon file bubble with name and 'size TYPE'; clicking a PDF opens it in the browser's PDF viewer in a new tab (blob URL, no server header change), other files download"
status: merged
milestone: M5
branch: task/T-1322-web-file-bubble-open
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1322: Web file bubble and PDF open

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: the phone changes must also be done on web. On mobile, T-1319 made the file bubble Telegram-style (`apps/mobile/src/components/chat/file-bubble.tsx`) and opens a tapped PDF in the system PDF viewer.

Web today (`apps/web/src/components/FileMessage.tsx`, 74 lines):
- a raised card with a square icon;
- the subtitle shows the raw MIME type ("3.9 KB · application/pdf");
- a download button: an `<a download>` to the `/api/files` URL.

The server serves every `kind: 'file'` as `content-disposition: attachment` with `default-src 'none'; sandbox` (`apps/server/src/files/api.ts:122-174`, SEC-1). **Keep those headers.**

### What to build
1. **The bubble** matches mobile's `file-bubble.tsx`:
   - no inner card;
   - a round 44–48 px accent circle with a lucide `FileText` icon, which shows `ArrowDown` before the first open and a spinner while fetching;
   - the name (semibold, one line), and "3.9 KB PDF" (size plus the upper-case extension, the same helper idea as mobile; put a shared formatter in `packages/chat-core` if one doesn't exist, and cite it).
   Keep the uploading, failed and retry states.
2. **Clicking the bubble or circle:**
   - for `application/pdf` (by MIME, or the `.pdf` extension when the MIME is generic): `fetch` the `/api/files` URL (same credentials as today), make a `Blob` with type `application/pdf`, `URL.createObjectURL`, and `window.open` it in a new tab (revoke after about 60 s);
   - **only PDF is opened this way:** never HTML, SVG or other active types;
   - everything else keeps today's download.
   - Keep a "Download" item, for example in the message's context menu or as a small secondary button, so a PDF can still be saved.
3. Every file stays at most 400 lines. **No tests** (UI), unless you add the formatter to chat-core; then add one small test there.

### Read first
`AGENTS.md`, `apps/web/src/components/FileMessage.tsx`, `apps/web/src/lib/attachments.ts`, `apps/mobile/src/components/chat/file-bubble.tsx` (the look to match), and `apps/server/src/files/api.ts:122-174`.

### Allowed files
`apps/web/src/components/FileMessage.tsx`, `apps/web/src/components/file/**/*.tsx`, `apps/web/src/components/file/**/*.ts`, `apps/web/src/lib/attachments.ts`, `apps/web/src/lib/open-file.ts`, `packages/chat-core/src/files.ts`, `packages/chat-core/src/files.test.ts`, `packages/chat-core/src/index.ts`, `work/T-1322-web-file-bubble-open.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** the file bubble looks like mobile's; a PDF opens in a new tab and other files download.

---

## Report (written by the worker when done)

**Status: done, ready for review.**

### What I did

Web file bubble, parity with mobile's `file-bubble.tsx` (T-1319).

- **Shared formatter in chat-core** (none existed): new `packages/chat-core/src/files.ts` with `fileExtension(name)` (upper-case extension), `formatFileMeta(size, name)` ("3.9 KB PDF", reusing `formatFileSize` from `media.ts`), and `isPdfAttachment({ name, mime })` (`application/pdf`, or a `.pdf` name when the MIME is generic: empty, `application/octet-stream`, `binary/octet-stream`). Exported from `index.ts`.
- **`apps/web/src/components/FileMessage.tsx`** rewritten to the mobile look: no inner card; a 48 px round accent circle (`bg-accent`/`text-accent-foreground`, or `bg-bubble-in`/`text-foreground` on the light outgoing bubble, as the mobile row swaps its accent on outgoing), a lucide `FileText` icon that is `ArrowDown` before the first action and a `Loader2` spinner while fetching; the name (semibold, one line) and `formatFileMeta` below. Uploading, failed and retry states kept (failed shows Retry; uploading shows the spinner and "Uploading…").
- **Open vs download**: tapping the bubble (or its circle) fetches a PDF through `GET /api/files` (session cookies, same as before), wraps the bytes in an `application/pdf` `Blob`, `URL.createObjectURL`s it, `window.open`s it in a new tab, and revokes it after 60 s. Non-PDF files keep today's download (programmatic `<a download>`). Only PDFs take the open path; HTML/SVG and everything else download.
- **Download item for PDFs**: a small secondary round `IconButton` next to the bubble. I used the secondary-button option from the spec because the message context menu lives in `apps/web/src/components/message/MessageMenu.tsx`, which is not in the Allowed files. The button only shows for PDFs, since every other file already downloads on tap.
- **`apps/web/src/lib/open-file.ts`** (new) holds the browser side: `openPdfInNewTab(url, name, onSettled)` and `downloadFile(url, name)`. Written with Effect (`Effect.fnUntraced` + `runWeb`, like `lib/attachments.ts`) because it uses `fetch`, so the Effect ratchet sees an `effect` file; the component itself has no async signals.

The server headers are untouched (`apps/server/src/files/api.ts` still sends every `kind: 'file'` as `content-disposition: attachment` with the `default-src 'none'; sandbox` CSP, SEC-1).

### Files changed

- `packages/chat-core/src/files.ts` (new)
- `packages/chat-core/src/files.test.ts` (new, 8 tests)
- `packages/chat-core/src/index.ts` (`export * from './files'`)
- `apps/web/src/lib/open-file.ts` (new)
- `apps/web/src/components/FileMessage.tsx` (rewritten)
- `work/T-1322-web-file-bubble-open.md` (status + this report)

### Commands and real results

- `pnpm install` — done in 13.2 s, lockfile unchanged.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/files.test.ts` — **1 file passed, 8 tests passed**.
- `pnpm exec prettier --write <changed files>` — only `apps/web/src/lib/open-file.ts` needed reformatting (the `Effect.fnUntraced` signature collapsed to one line).
- `pnpm gate` — first run **GATE FAIL** on `format` (`apps/web/src/lib/open-file.ts`); after the Prettier write, a run printed:

```text
PASS  install (frozen)  (1.3s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.6s)
PASS  effect  (0.6s)
PASS  tests @zilar/chat-core  (2.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Notes and deviations

- The shared formatter went to chat-core as asked; mobile still keeps its own `sizeTypeOf`/`formatSize` in `file-bubble.tsx` (mobile is outside the Allowed files, so I left it), so that duplication still exists.
- A popup blocker can refuse `window.open` after the async fetch; in that case `openPdfInNewTab` falls back to the download path so the file is never silently lost.
- No web tests were added (UI), matching the spec; the chat-core formatter has the one small test.
- I did not run the live web app, so the visual "looks like mobile" check is the lead's web-mock review.

### Round 1 (fix round)

- **Finding 1 (should-fix) — fixed.** `apps/web/src/lib/open-file.ts`: the temporary download anchor in `downloadFile` now sets `link.target = '_blank'` and `link.rel = 'noopener noreferrer'`, matching the old anchor that `PREREVIEW.md` cites. For a cross-origin file URL (dev: the ejabberd upload service on `:5280`) that the browser does not honour `download` for, the programmatic click now opens the file in a new tab instead of navigating the chat away; same-origin `/api/files` downloads are unchanged. Both call sites (tapping the bubble and the PDF Download button) go through this function.
- **Tests: none added.** The fix is browser-DOM/UI behaviour. AGENTS.md says "UI code gets no tests" and the Spec says "No tests (UI)". A unit for `downloadFile` would be `apps/web/src/lib/open-file.test.ts`, which is not one of the task's Allowed files (the exact token is `apps/web/src/lib/open-file.ts`), so there is no in-scope test path to add one to. The gate agrees: `SKIP tests @zilar/web (no nearby test files)`.
- **Finding 2 (nit) — intentionally left.** The PDF-fetch timeout/abort lives in `openPdfTab` (`open-file.ts:19-33`) and `canOpen` (`FileMessage.tsx:43`), lines this fix does not change; the round says not to touch nits outside a line I already change. The fetch still has no timeout.
- **Commands:** no single test run (the touched file is web UI with no nearby test); `pnpm gate` from the repo root:

```text
PASS  install (frozen)  (1.4s)
PASS  format  (1.7s)
PASS  lint  (0.9s)
PASS  typecheck  (4.3s)
PASS  effect  (0.4s)
PASS  tests @zilar/chat-core  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

- **Commits:** `T-1322: fix finding 1 - open downloads in a new tab`, then this Report commit.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits, 1 follow-up).**
- **Lead's headless check** (Playwright Chromium, web mock of this branch, Ana):
  - the `tickets.pdf` bubble shows a round `ArrowDown` circle, the name, "2.3 MB PDF" and a download button;
  - with the PDF request served by the test, a click opens a new tab with the blob PDF (headless has no viewer, so it saves it as `<uuid>.pdf`);
  - with an unreachable mock URL, the fetch fails and it falls back to a download.
- **Server headers unchanged** (SEC-1). Only `application/pdf` goes to a blob tab.
- **Lead's checks:** web tsc: 0 errors; chat-core: 97 tests pass; `FileMessage.tsx` is 121 lines.
- **Follow-up F1:** mobile `file-bubble.tsx` should use the new shared `formatFileMeta`.
