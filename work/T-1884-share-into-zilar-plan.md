---
id: T-1884
title: "Plan (docs only): share into Zilar from other apps (Android share sheet first, iOS share extension second) — pick the library for Expo 57 / RN 0.86, how the shared text/link/photo/file reaches a chat picker (reuse forward-sheet), the send path, and an ordered task list; write docs/plan/share-into-zilar.md"
status: merged
milestone: M5
branch: task/T-1884-share-into-zilar-plan
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1884: Plan "share into Zilar" (docs only)

## Spec (written by Claude, do not edit)

### Why
**Audit finding MUX-19** (`docs/audit/findings-sweep-client.md`, still open): Zilar isn't in the system share sheet, so a photo, link or file from another app can't be sent to a chat. Telegram and WhatsApp both offer this. It's part of Julio's easy-life pass (2026-10-17). It needs a native piece, so this task only researches and plans. No code.

### Facts (read by the lead on 2026-10-17)
- **The app runs Expo `~57.0.25`, `expo-router` `~57.0.23` and `react-native` `0.86.3`** (`apps/mobile/package.json:33,51,63`).
- **`apps/mobile/app.json:22-38`:** Android intent filters are `VIEW` only (https App Links). There is no `SEND` / `SEND_MULTIPLE` filter.
- **`apps/mobile/src/app/+native-intent.tsx`** exists (expo-router's hook for incoming intents). Read it.
- **The forward picker** (`apps/mobile/src/components/chat/forward-sheet.tsx`, mounted in `chat-overlays.tsx`) already chooses chats to send a message to.
- **Attachments are uploaded and sent** through the existing composer/attachment path (find it under `apps/mobile/src/components/chat/attach*` and `apps/mobile/src/lib/attachment*`).

### What to answer (cite `file:line` in our code, and library docs or README links for anything outside)
1. **The library:** which maintained library fits Expo 57 with a config plugin (for example `expo-share-intent`)? Give its latest version, its Expo SDK support, what it adds to `app.json`, and whether it needs a dev-client rebuild (it will; we ship APKs). If none fits, name the fallback (a small config plugin plus `+native-intent.tsx`).
2. **What arrives:** text, a URL, one image or several, a file (mime, size). What the app gets on cold start versus when it is already running, and how `+native-intent.tsx` or the library hands it over.
3. **The flow:** shared item → a picker of chats (reuse `forward-sheet.tsx` or extract its list) → send.
   - Text and links go as a message.
   - Images and files go through the existing upload path, with its caps (`apps/server/src/files` and the upload limits).
   - It must work when logged out (show login, then continue) and when the picker is cancelled.
4. **Security:** shared content is untrusted. Cover:
   - file size caps before upload;
   - only `content://`/`file://` from the intent;
   - no auto-send without a tap.
5. **iOS:** what a share extension needs on Expo (a separate target), and whether the same library covers it. iOS can be a later phase.
6. **An ordered task list,** each ≤ 45 worker minutes with its files. The native or config step must be its own task (it changes `app.json` and dependencies, which needs Julio's OK because it adds a native dependency). Mark that one "needs Julio".

### Steps
1. Write `docs/plan/share-into-zilar.md`, under 220 lines.
2. Don't change any code or `package.json`.

### Allowed files
- `docs/plan/share-into-zilar.md`
- `work/T-1884-share-into-zilar-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan answers 1–6** with citations.
- **It recommends one library or approach,** and gives an ordered task list with the native step marked "needs Julio".
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Read this task and `AGENTS.md` completely, then the paths the spec names:
  `+native-intent.tsx`, `forward-sheet.tsx`, the attachment picker/uploader/store
  path, `apps/server/src/files`, the ejabberd upload cap, `RequireAuth`/`AuthFlow`
  and the audit finding.
- Wrote `docs/plan/share-into-zilar.md` (207 lines, under the 220 limit). It
  answers points 1–6 with `file:line` citations and library links:
  1. **Library:** `expo-share-intent` 8.0.1 (npm latest, checked 2026-10-17);
     peer range `expo ^57`, `expo-linking >=57.0.1`, `expo-constants >=57.0.3`;
     plugin options for `SEND`/`SEND_MULTIPLE` and iOS activation rules; needs
     a new native build/APK. Fallback (own config plugin + local Expo module)
     is named and rejected as more work, not as the recommendation.
  2. **What arrives:** type/text/webUrl/files/meta shape, null sizes,
     `content://` on Android, cold start vs running, and the
     `dataUrl=zilarShareKey` branch in `+native-intent.tsx`.
  3. **Flow:** `/share` → normalize → in-memory pending share → extracted
     `ChatPickerList` (from `forward-sheet.tsx`) → `sendText` / `sendAttachment`
     → reset + open chat. Covers caps (`MAX_ATTACHMENT_BYTES` 50 MB, ejabberd
     `max_size`), cancel, and logged-out resume through `RequireAuth`/`AuthFlow`.
  4. **Security:** zod validation, 32 KiB text cap, path allowlist
     (`file://` under the app cache/app group, `content://` copied to cache),
     stat-and-refuse before any slot/PUT, no auto-send, no logging of content,
     cache cleanup, only our scheme/share key routes to `/share`.
  5. **iOS:** same package, separate extension target and app group
     (`group.app.zilar.chat`), EAS extension credentials, later phase.
  6. **Ordered tasks:** 8 tasks, each ≤ 45 min, with files. Task 1 (native
     dependency + `app.json`) is marked **needs Julio**; task 7 (phone smoke)
     and task 8 (iOS phase) also need him.
- Made no code or `package.json` changes, per the spec.

### Checks run
- `pnpm install` → `Done in 19.2s using pnpm v10.32.1`.
- `pnpm gate` → `GATE PASS`, with:
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (1.2s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `gate: 2 changed file(s) against main`
- No unit tests run: this task changes documentation only.

### Notes for the lead
- The library's latest version and peer range were read from the npm registry
  (`registry.npmjs.org/expo-share-intent/latest`) and its README/source on
  GitHub; nothing was installed.
- Task 1 is the release-blocking native change (a new APK; OTA cannot add the
  module). MUX-19 can be closed only after the phone smoke in task 7.
- One assumption to verify in task 3/6: the share payload and the native intent
  must survive the in-app `/login` navigation. The plan keeps the payload in
  memory and resets the native intent only on send/cancel; the smoke test must
  cover a logged-out share.
- No open questions; nothing blocked.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1c4e0556d`.
- **The plan:** it recommends `expo-share-intent` 8.0.1 for SDK 57. The pre-reviewer confirmed the version against the npm registry.
- **The order:** a `/share` route, the forward-sheet list extracted, then the existing send path. Task 1 (the native dependency plus a new APK) is marked "needs Julio".
- **Correction for the specs:** task 2 says "zod schema", but the repo uses Effect `Schema` (zod was replaced on 2026-10-07). The specs will say Effect Schema.
- **Next:** tasks 2–6 import the library's types, so the series waits for Julio's OK on task 1 (listed in NOW.md, "For Julio").
