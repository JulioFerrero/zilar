---
id: T-1324
title: "Web attach like Telegram (parity with mobile T-1320): the paperclip opens a small menu 'Photo or video' / 'File'; chosen photos open a send dialog with a grid preview, caption and 'Send N' (album), files send as files"
status: merged
milestone: M5
branch: task/T-1324-web-attach-menu
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1324: Web attach menu and send dialog

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: the phone changes must also be done on web. Mobile T-1320 made the attach sheet Telegram-style: a gallery grid with numbered selection and "Send N", with Gallery and File tabs.

Web today: the paperclip (`apps/web/src/components/composer/ComposerControls.tsx:177-192`, 285 lines) opens the OS picker directly (`<input type="file" multiple>`), and picked files show as a bar above the composer (`apps/web/src/components/AttachmentPreview.tsx`, 46 lines).

Telegram Web:
1. the paperclip opens a small pop-up menu: "Photo or Video", "File";
2. picking photos opens a centred dialog, "Send 2 Photos", with:
   - the previews in a grid (one large when there's one);
   - a caption field;
   - an option to send as files instead;
   - Send.

### What to build
1. **The paperclip opens a menu** with "Photo or video" (an input with `accept="image/*,video/*"`, `multiple`) and "File" (any type, `multiple`), with lucide icons. It closes on Escape or an outside click; reuse the app's existing menu or popover component (cite it).
2. **The send dialog for photos and videos:**
   - a grid of previews, where × on a tile removes it;
   - a caption textarea (prefilled with the composer's current text, which moves into the dialog);
   - a "Send as files" checkbox;
   - Send / Cancel, with Enter to send and Escape to cancel.
   Send uses the existing send path for picked files and albums (cite where `acceptFiles` leads; albums are max 10, as decided in `docs/audit/albums-plan.md` §8), so the caption and album behaviour stay as today. For "File", either use the same dialog with a file list, or keep today's preview bar; say which.
3. **Drag and drop / paste** of files keeps working (cite where it's handled) and opens the same dialog for images.
4. Every file stays at most 400 lines; new components go under `apps/web/src/components/attach/`. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/composer/ComposerControls.tsx`, `apps/web/src/components/Composer.tsx` (393 lines: keep changes tiny), `apps/web/src/components/AttachmentPreview.tsx`, and `docs/audit/albums-plan.md` §8.

### Allowed files
`apps/web/src/components/composer/*.tsx`, `apps/web/src/components/composer/*.ts`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/AttachmentPreview.tsx`, `apps/web/src/components/attach/**/*.tsx`, `apps/web/src/components/attach/**/*.ts`, `work/T-1324-web-attach-menu.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - the paperclip shows the menu;
  - picking two images opens "Send 2 photos" with a grid and caption, and Send posts an album;
  - File sends a document.

---

## Report (written by the worker when done)

### What I did

Built the Telegram-style attach flow on web (parity with mobile T-1320):

- **The paperclip opens a menu** (new `apps/web/src/components/attach/AttachMenu.tsx`,
  83 lines). It reuses the app's shared menu, `apps/web/src/components/ui/menu.tsx`
  (`Menu` + `MenuItem`, the same one `NewChatButton`/`ChatHeader` use), which already
  closes on Escape and on an outside click and returns focus to the paperclip. Two
  entries with lucide icons: **Photo or video** (a hidden `<input type="file"
  accept="image/*,video/*" multiple>`) and **File** (a hidden `<input type="file"
  multiple>`, no `accept`). This replaces the old inline input + paperclip in
  `ComposerControls.tsx`.
- **The send dialog for a media pick** (new
  `apps/web/src/components/attach/AttachSendDialog.tsx`, 189 lines, built on the kit
  `Dialog`): a title ("Send 2 Photos", "Send Photo", "Send Video", "Send File"), a
  grid of 3-column previews (one large preview when there is a single item), a × per
  tile that removes it, a caption textarea prefilled from the composer's text, a
  **Send as files** checkbox (`ui/checkbox`) and Send / Cancel. Enter sends,
  Shift+Enter is a newline; Escape cancels through `Dialog`/`useModal`. The dialog is
  mounted only while open, so its "Send as files" state is fresh each time.
- **The send path is unchanged**: `Send` calls the composer's existing `send()`
  (`apps/web/src/components/Composer.tsx`, `send` → `attachments.sendPending`), which
  runs `sendAttachment` per file and gives 2+ photos one `urn:zilar:album:0` id
  (`useComposerAttachments.ts`, `sendPending`; cap 10 as in `docs/audit/albums-plan.md`
  §8). The caption and the reply ride the first file exactly as before.
- **"Send as files"**: since the web never re-encodes photos, the only real
  difference is that the album grouping is dropped, so each file is its own message
  (`sendPending({ asFiles: true })` skips the `album` option). I added this option
  rather than a second send path.
- **"File" keeps today's preview bar** (`AttachmentStrip` / `AttachmentPreview`): a
  File pick does **not** open the dialog, it stages the file and the strip above the
  composer stays — this is the "either/or" the spec left open. The dialog is used
  only for media picks.
- **Drag & drop and paste keep working and open the dialog for images**: both funnel
  through `acceptFiles` in `useComposerAttachments.ts` (`document` dragover/drop
  listener at the drop effect, and `onPaste`); both now pass `{ media: true }`, so an
  image pick opens the same dialog while a non-media file keeps the strip.
- The staged strip is hidden while the dialog is open, and chatting away (`reset`) or
  sending closes the dialog. Removing the last tile closes it too.

### Files changed

- `apps/web/src/components/attach/AttachMenu.tsx` (new, 83 lines)
- `apps/web/src/components/attach/AttachSendDialog.tsx` (new, 189 lines)
- `apps/web/src/components/composer/useComposerAttachments.ts` (dialog state,
  `media` pick flag, `sendPending({ asFiles })`, `closeAttachDialog`; removed the now
  unused `fileInputRef`)
- `apps/web/src/components/composer/ComposerControls.tsx` (paperclip → `AttachMenu`,
  renders the dialog, hides the strip while it is open)
- `apps/web/src/components/Composer.tsx` (`send(options?)` forwards to `sendPending`)
- `work/T-1324-web-attach-menu.md` (status + this Report)

All files are ≤ 400 lines. No tests added (spec says UI gets none; the gate reports
`SKIP tests @zilar/web (no nearby test files)`).

### Commands and real results

- `pnpm install` → "Done in 22.4s using pnpm v10.32.1".
- No single test file applies to this change (UI, no test file nearby), so I ran none.
- `pnpm gate` from the repo root:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.5s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (The first run failed on format — Prettier rewrapped two lines; I ran
  `pnpm exec prettier --write` on those two files and re-ran. A second failure was an
  `react(set-state-in-effect)` lint error from a cleanup effect I had added; I removed
  the effect and close the dialog from `removeAttachment` instead. The final run is
  the GATE PASS above.)

### Deviations from the spec

- "Send as files" drops the album marker (separate messages) because the web app
  never compresses photos; the bytes sent are identical either way.
- The dialog shows a film icon + filename for a video (no thumbnailer exists for
  video in the web app), and a FileText icon for any other type.
- A pick that is not all photos (e.g. two videos) still stages only the first file,
  as it did before this task (`acceptFiles` single-attachment rule); only the
  all-photos path is an album. The dialog displays whatever is staged.

### Open questions

- None blocking. If a video thumbnail is wanted in the dialog, that needs a
  thumbnail source (out of scope here).

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (3 nits).**
- **Lead's headless check** (Playwright Chromium against the web mock of this branch, Marta):
  - the paperclip menu shows ["Photo or video", "File"];
  - the photo input has `accept="image/*,video/*"` and `multiple`;
  - two images open "Send 2 Photos" (a grid, "Add a caption…", "Send as files", Cancel, Send);
  - the caption "Two shots" + Send posts a 2-photo album with the caption, and the dialog closes.
- **Lead's checks:** web tsc: 0 errors; the largest files are `Composer.tsx` (393, unchanged) and `useComposerAttachments.ts` (381).
