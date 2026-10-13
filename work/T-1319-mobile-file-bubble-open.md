---
id: T-1319
title: "Mobile files like Telegram: the file bubble is a round icon + name + 'size TYPE' (no inner card, download progress on the circle), and tapping a file opens it in the app for that type (PDF viewer) via an Android VIEW intent — not the share sheet; iOS opens an in-app preview where possible"
status: merged
milestone: M5
branch: task/T-1319-mobile-file-bubble-open
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1319: File bubble and "open with its app" (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, after sending a PDF on his phone, with Telegram screenshots for comparison:
- **The bubble:** "has nothing to be like in Telegram". Telegram's file bubble (in the bubble itself, no inner card) is:
  - a round 48 dp icon, an accent circle with a document icon, which shows a download arrow and a progress ring while the file loads;
  - next to it, the file name (semibold, one line, ellipsis), and under it "3.9 KB PDF" (size plus the upper-case extension);
  - the time and ticks at the bottom right as usual.
  Zilar today draws a raised dark card inside the bubble (`AttachmentFileRow`, `apps/mobile/src/components/chat/attachment-message.tsx:226-345`, 345 lines).
- **Opening:** "when I click, it shows me a list of apps to share the document; no, I'd like it to open the app for that type of file, in this case the PDF viewer." Today `apps/mobile/src/lib/attachment-opener.ts:57` calls React Native's `Share.share({ url })`, which is the share sheet. Telegram on Android sends a VIEW intent with the file's MIME type, so the system opens the PDF viewer (or asks "Open with" once).

### What to build
1. **Open with the type's app.**
   - **Android:** download the file to the cache as today (cite the download step in `attachment-opener.ts`), then get a `content://` URI for it (the file uses the new `expo-file-system` API, `File`/`Paths`, `attachment-opener.ts:8`; use `File`'s content-URI accessor if the installed version has one, otherwise `getContentUriAsync` from `expo-file-system/legacy`; cite which), and start `android.intent.action.VIEW` with that URI, the attachment's MIME type and `FLAG_GRANT_READ_URI_PERMISSION`, using **`expo-intent-launcher`**. Add that one official Expo package to `apps/mobile/package.json` at the version matching the Expo SDK of the other `expo-*` packages (they're `~57.x`), and run `pnpm install`.
   - If no app can open the type (the intent fails), fall back to today's `Share.share`.
   - **iOS:** keep today's behaviour unless a maintained official Expo module gives an in-app QuickLook preview; don't add a third-party native module. Say what you chose in the Report.
   - Images and videos keep their in-app viewer; this is for `kind: 'file'` (PDF, documents, archives…).
2. **The bubble**, matching Telegram (above):
   - no inner card;
   - an accent-coloured circle with a lucide `FileText` (or `File`) icon, which becomes `ArrowDown` before the first open and a progress ring while downloading (reuse any progress the download step already reports);
   - name and "3.9 KB PDF".
   - Keep the untrusted, uploading and failed states, restyled to the same layout.
   - **`attachment-message.tsx` is 345 lines:** move the file bubble into a new `apps/mobile/src/components/chat/file-bubble.tsx`, so no file goes over 400.
3. **No tests** (UI and native glue), but keep `apps/mobile/src/lib/attachments.test.ts` passing.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/lib/media-source.ts` (files load through `/api/files` with the bearer token, T-1185), and `apps/mobile/package.json`.

### Allowed files
`apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/components/chat/file-bubble.tsx`, `apps/mobile/package.json`, `apps/mobile/app.json`, `pnpm-lock.yaml`, `work/T-1319-mobile-file-bubble-open.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** a release APK on the emulator renders the file bubble Telegram-style. On Julio's phone, tapping a PDF opens the PDF viewer.

---

## Report (written by the worker when done)

### What I did

**Open with the file type's app** (`apps/mobile/src/lib/attachment-opener.ts`)

- Android: the file still downloads to the cache dir as before, then the opener
  gets a `content://` URI and starts `android.intent.action.VIEW` through
  `expo-intent-launcher`, with the file's MIME type and
  `FLAG_GRANT_READ_URI_PERMISSION` (= 1), so the system opens the PDF viewer (or
  asks "Open with" once). If the content-URI step or the VIEW intent fails (no
  app for the type), it falls back to today's `Share.share`.
- Which content-URI API: the installed `expo-file-system` is **57.0.7**; its new
  `File` class has **no** content-URI accessor, so I used `getContentUriAsync`
  from `expo-file-system/legacy` (the path the spec names for that case).
- iOS: kept `Share.share`. Expo ships no maintained in-app QuickLook viewer and
  the task forbids a third-party native module.
- Added `expo-intent-launcher@~57.0.1` (matching the other `expo-*` at `~57.x`)
  and ran `pnpm install`. `app.json` needs no change: the package autolinks, its
  `expo-module.config.json` is `["android"]` and it ships no config plugin;
  importing it on iOS is safe (the non-Android file is an empty object).
- Images and videos keep their in-app viewer; this path is only `kind: 'file'`.

**The bubble** (new `apps/mobile/src/components/chat/file-bubble.tsx`)

- `AttachmentFileRow` moved out of the 345-line `attachment-message.tsx` into
  `file-bubble.tsx` (161 lines); no file is over 400.
- No inner card: a 48 dp round circle, the file name (semibold, one line,
  ellipsis) and "3.9 KB PDF" (size plus the upper-case extension). The circle
  shows `ArrowDown` before the first open, `FileText` after, and an
  `ActivityIndicator` while opening/uploading.
- The untrusted, uploading and failed states are kept, restyled to the same row
  layout ("Not loaded: untrusted address", "Uploading… NN%", "Upload failed" +
  retry, "Couldn't load" + retry).
- `attachment-body.tsx` and `attachment-message.tsx` were updated to import the
  moved component and to pass `outgoing` down (the light own bubble needs dark
  text).

### Files changed

- `apps/mobile/src/lib/attachment-opener.ts` — Android VIEW intent + share fallback.
- `apps/mobile/src/lib/attachment-native.ts` — doc comment only.
- `apps/mobile/src/components/chat/file-bubble.tsx` — new file bubble.
- `apps/mobile/src/components/chat/attachment-message.tsx` — file row moved out; image fallbacks pass `outgoing`.
- `apps/mobile/src/components/chat/attachment-body.tsx` — imports the moved row; passes `outgoing`.
- `apps/mobile/package.json`, `pnpm-lock.yaml` — `expo-intent-launcher`.
- `work/T-1319-mobile-file-bubble-open.md` — this report.

(`apps/mobile/app.json` is in scope but unchanged, see above.)

### Commands and results

- `pnpm install` — done; added `expo-intent-launcher@57.0.1`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/attachments.test.ts` — 1 file passed, 4 tests passed.
- `pnpm gate` — **GATE PASS**:
```
gate: 8 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (0.8s)
PASS  typecheck  (2.5s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

I could not run the emulator/phone acceptance check from here; only the gate
and the unit test ran. The APK/phone checks are the lead's.

### Deviations from the spec

1. **MIME type from the name's extension.** The spec says to send "the
   attachment's MIME type", but `AttachmentOpener.open` is `(url, name)` in
   `apps/mobile/src/lib/attachment-ports.ts`, which is **not** in the Allowed
   files, and its caller (`chat-thread.tsx`) passes no MIME either, so the
   opener only receives the file name. I map ~20 common extensions (PDF, office,
   archives, …) and fall back to `application/octet-stream`.
2. **The progress ring is an indeterminate `ActivityIndicator`.** Real download
   progress is not plumbed through the fixed opener port, so the circle shows a
   spinner while opening. The upload state still shows its real percentage in
   the meta line ("Uploading… NN%").
3. **The circle colour flips on an own bubble.** The app accent is `#ededed`; on
   an outgoing bubble (light, `#fff → #dedede`) that circle would be invisible,
   so outgoing bubbles use the dark incoming surface (`#161616`) with a light
   icon, while incoming bubbles use the accent circle.
4. **`ArrowDown` → `FileText` after the first tap** is tracked with local
   component state; a failed open also flips it to `FileText` (the row stays
   tappable).

### Open questions

- None blocking; confirm the four deviations are acceptable.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit, 2 follow-ups).**
- **Android:** download as today, then a content URI and a VIEW intent via `expo-intent-launcher ~57.0.1`, with `Share.share` as the fallback. iOS is unchanged.
- **The bubble** is now `file-bubble.tsx` (164 lines): a round icon, the name, and size + type. **Lead's check on the emulator mock (Ana):** the Telegram layout, a circle with `ArrowDown`, no inner card; mock files show the untrusted subtitle.
- **Lead's checks:** mobile tsc: 0 errors; `attachment-message.tsx` went from 345 to 229 lines.
- **Julio checks on his phone:** tapping a PDF opens the PDF viewer.
- **Follow-ups:**
  - pass the real MIME type instead of guessing from the extension;
  - a real progress ring.
