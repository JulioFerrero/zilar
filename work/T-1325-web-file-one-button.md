---
id: T-1325
title: "Web file bubble has one button like Telegram: drop the extra download button; the circle shows FileText for a PDF (click opens) and ArrowDown for other files (click downloads); 'Download' moves to the message's context menu for files"
status: merged
milestone: M5
branch: task/T-1325-web-file-one-button
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1325: One button on the web file bubble

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, screenshot of a `Comprovant.pdf` bubble on web: "why two download buttons?" T-1322 (`apps/web/src/components/FileMessage.tsx`, 121 lines) draws:
- the round circle with `ArrowDown` (`:84-85`), which for a PDF actually **opens** the file;
- plus a secondary round `Download` button, added because the message menu (`apps/web/src/components/message/MessageMenu.tsx`, 246 lines) wasn't in that task's Allowed files.

Telegram shows **one** circle; save/download is in the message's context menu.

### What to build
1. **Remove the secondary Download button** from `FileMessage.tsx`.
2. **The circle's icon tells what a click does:**
   - a PDF shows `FileText` (click opens it in a new tab, as today);
   - any other file shows `ArrowDown` (click downloads);
   - the spinner while fetching stays.
   Update the `aria-label`s to match.
3. **"Download" in the message's context menu** (`MessageMenu.tsx`) for any message with a `kind: 'file'` attachment, using `downloadFile` from `apps/web/src/lib/open-file.ts`, with a lucide `Download` icon. Place it after Copy, or where Copy would be for a file. Find how the menu receives the message, and cite it.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/FileMessage.tsx`, `apps/web/src/lib/open-file.ts`, `apps/web/src/components/message/MessageMenu.tsx`, and where `MessageMenu` is rendered (cite it).

### Allowed files
`apps/web/src/components/FileMessage.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageListRow.tsx`, `apps/web/src/lib/open-file.ts`, `apps/web/src/components/MessageActionsMenu.tsx`, `work/T-1325-web-file-one-button.md`. (Lead, 2026-10-13: `MessageActionsMenu.tsx` was added after the worker's block.)

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** a PDF bubble has one circle with a document icon; the message menu has Download.

---

## Report (written by the worker when done)

**Status: done, ready for review.**

### What I did

1. **Removed the secondary round Download button** from `FileMessage.tsx` (the failed-upload Retry button is kept).
2. **The circle's icon tells what a click does:** `FileText` for a PDF (click opens it in a new tab through the browser's viewer), `ArrowDown` for any other file (click downloads); the `Loader2` spinner while fetching is unchanged. The `aria-label` is still `Open <name>` for a PDF and `Download <name>` for other files; the now-unused `opened` state and the `Download` lucide import were removed, and the doc comment was updated.
3. **"Download" in the message's context menu.** `MessageMenu.tsx` (which receives `message: UiMessage` at `:81` and `chatId`) resolves the file attachment the same way the bubble does (`safeHttpUrl` + `mediaSrc(chatId, url)`) and passes `canDownload`/`onDownload` to `MessageActionsMenu.tsx`; `MessageActionsMenu` renders a lucide-`Download` `MenuItem` right after Copy text, shown only when `canDownload` is true. The handler closes the menu and calls `downloadFile` from `apps/web/src/lib/open-file.ts`.

### Round 1: the blocked point 3 (resolved)

The first pass blocked: the menu items are rendered by `apps/web/src/components/MessageActionsMenu.tsx` (not `MessageMenu.tsx`), which was outside the Allowed files. The lead approved and added `MessageActionsMenu.tsx` to the Allowed files (the task file, committed with this work).

### Files changed

- `apps/web/src/components/FileMessage.tsx` (points 1 and 2)
- `apps/web/src/components/MessageActionsMenu.tsx` (point 3: `canDownload`/`onDownload` props + the Download item)
- `apps/web/src/components/message/MessageMenu.tsx` (point 3: resolve the file URL, pass the props)
- `work/T-1325-web-file-one-button.md` (this file)

Line counts (≤ 400): `FileMessage.tsx` 111, `MessageActionsMenu.tsx` 171, `MessageMenu.tsx` 266.

### Commands and real results

- `pnpm install` — `Done in 10.6s using pnpm v10.32.1` (lockfile unchanged).
- `pnpm gate` (final, 4 changed files) — `GATE PASS`:
  ```text
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test file was run: `apps/web` has no test near the changed files, and the Spec says no tests (UI).

### Notes / deviations

- The Download item shows for any message with a `kind: 'file'` attachment (as the Spec says), including a GIF-origin video file attachment; it is hidden only when the URL is not a safe http(s) URL.
- `MessageBubble.tsx` / `MessageListRow.tsx` needed no change: `MessageMenu` already receives the message and chat id.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (0 nits); the packet is current for `a34ed787`.**
- The worker blocked once on `MessageActionsMenu.tsx`, which held the menu items; the lead added it to the Allowed files.
- **Lead's headless check** (Playwright Chromium, web mock of this branch, Ana):
  - the `tickets.pdf` bubble shows one circle with the `FileText` icon; the only button naming the file is "Open tickets.pdf";
  - the right-click menu has Reply, Forward, Select, Copy text (disabled), **Download**, Delete for me, Pin.
- **Lead's checks:** web tsc: 0 errors; `MessageMenu.tsx` is 266 lines and `MessageActionsMenu.tsx` 171.
