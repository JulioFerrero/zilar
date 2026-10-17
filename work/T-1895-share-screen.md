---
id: T-1895
title: "Share into Zilar, tasks 4+6: the /share screen — a share from another app opens it (Android SEND via the root provider, plus the +native-intent dataUrl branch), it previews the validated draft, picks ONE chat with ChatPickerList single, and only the Send tap sends (text via sendText; files copied from content:// into the cache, then sendAttachment with the text as the first file's caption); Cancel sends nothing"
status: merged
milestone: M5
branch: task/T-1895-share-screen
model: auto
effort: default
depends_on: [T-1891, T-1892, T-1894]
estimate: 45 min
---

# T-1895: The /share screen (share plan tasks 4 + 6)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/share-into-zilar.md` §2, §3, §4 and §6 tasks 4 and 6** (Julio approved the feature on 2026-10-17). This task makes the share sheet work end to end: the user shares a photo, link, text or file to Zilar, picks a chat and taps Send.

**The screen uses only existing pieces,** the Forward sheet's look as a page:
- the screen frame from `explore.tsx`;
- `ChatPickerList`;
- `Button`.

No new visual design.

### Facts (read by the lead on 2026-10-17)
- **The provider:** `ShareIntentProvider` (`resetOnBackground`) wraps the app (`apps/mobile/src/app/_layout.tsx`, T-1891). Read the library's README and expo-router example in your worktree's `apps/mobile/node_modules/expo-share-intent/` for:
  - `useShareIntentContext()` (`hasShareIntent`, `shareIntent`, `resetShareIntent`);
  - `getShareExtensionKey()`;
  - how it routes an Android share in an expo-router app. The plan §2: a `+native-intent` branch on `dataUrl=<key>`, and the provider's `hasShareIntent` on Android.
- **Routing:** `apps/mobile/src/app/+native-intent.tsx` (9 lines) returns `webPathToAppPath(path)`.
- **The draft:** `toShareDraft(intent: unknown)` → `{ ok: true, draft: { text?, files: PickedFile[] } } | { ok: false, message }` (`apps/mobile/src/lib/share-intent.ts`, T-1892).
- **The picker:** `ChatPickerList({ chats, selected, onToggle, mode: 'single' })` (`apps/mobile/src/components/chat/chat-picker-list.tsx`, T-1894) applies the Forward rules: no archived chats, no channels you can't post in.
- **The store:** `useChatStore((s) => s.chats)`, `sendText(chatId, text)` and `sendAttachment(chatId, file, { caption })` (`apps/mobile/src/store/types.ts:148,152`). The existing upload path enforces the 50 MB cap and the empty-file rule.
- **The screen frame:** `apps/mobile/src/app/explore.tsx:52-59` wraps its body in `RequireAuth`, which redirects to login and back to `from`. Copy its header/back-button frame (`SafeAreaView`, `IconButton` with `ChevronLeft`).
- **Copying `content://` into the cache:** `apps/mobile/src/lib/save-photo.ts:12,54` uses `File`/`Paths.cache` from `expo-file-system`; `cacheFileName` and `deleteQuietly` are exported there (`:26,33`).

### Steps
1. **`+native-intent.tsx`:** before `webPathToAppPath`, if `path` contains `dataUrl=${getShareExtensionKey()}`, return `/share`. If the library documents a different check for Android, follow it and say so.
2. **Android handover:** if the library's expo-router guide says Android needs it, add a tiny `ShareIntentRedirect` component in `_layout.tsx`, inside the provider and the router. When `hasShareIntent` turns true it calls `router.push('/share')` once. Keep `_layout.tsx` at most 400 lines.
3. **New `apps/mobile/src/lib/share-send.ts`:** `export async function sendShare(chatId, draft, store, deps?)`.
   - Text-only → `store.sendText(chatId, draft.text)`.
   - With files:
     - each `content://` uri is first copied into `Paths.cache` (a `file://` uri is used as is);
     - then `store.sendAttachment(chatId, file, i === 0 && draft.text ? { caption: draft.text } : undefined)`;
     - a copy failure stops before any send and resolves `{ ok: false, message: 'Could not read that file. Try again.' }`.
   - Success resolves `{ ok: true }`.
   - Delete the cache copies only when they are no longer needed. If the upload pipeline reads the file later, leave them, and say what you found in your Report.
4. **New `apps/mobile/src/app/share.tsx`:**
   - `RequireAuth` → the screen. The title is "Send to", with a back key.
   - A short preview of the draft: the text, cut to 3 lines, and/or "N files" with the first file name.
   - `ChatPickerList` in single mode (`selected` holds at most one id), then a full-width `Button` "Send", disabled until a chat is picked or while sending.
   - **Errors and the empty state:** a refused draft (`ok: false`) or no share shows the message plus a "Close" button.
   - **Send:** `sendShare` → `resetShareIntent()` → `router.replace('/chat/[id]', …)` for that chat. A failure shows the message and keeps the screen.
   - **Back / Close:** `resetShareIntent()` and leave. Nothing is sent.
5. **No new tests** (UI plus a thin wrapper over the store). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/app/+native-intent.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/lib/share-send.ts`
- `work/T-1895-share-screen.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A share into Zilar opens `/share`,** which previews it, lists postable chats, and sends to the one picked only on Send.
- **Text goes as a message;** files go as attachments, with the text as the first caption.
- **Cancel sends nothing.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/app/+native-intent.tsx`** — a share link (`path` containing
  `dataUrl=${getShareExtensionKey()}`) now returns `/share`; every other path
  still goes through `webPathToAppPath`. This is exactly what the library's
  expo-router example does (I read the README's "Expo Router" section and
  fetched the upstream `example/expo-router/app/+native-intent.ts` and
  `_layout.tsx`).
- **`apps/mobile/src/app/_layout.tsx`** — a `ShareIntentRedirect` inside
  `ShareIntentProvider` (and the router context) reads `hasShareIntent` and, on
  the transition to `true`, calls `router.push('/share')` once; it resets the
  guard when the intent clears and never pushes over `/share` itself. This is
  spec step 2, added in the fix round (see Round below).
- **`apps/mobile/src/lib/share-send.ts`** — `sendShare(chatId, draft, store,
  deps?)`: text-only calls `store.sendText`; files are sent with
  `store.sendAttachment`, the text as the first file's `caption`. Each
  `content://` uri is copied into `Paths.cache` first (name sanitised from the
  shared name, unique per send) and the copied file's real size replaces the
  sender's; `file://` uris are used as is. A copy failure returns
  `{ ok: false, message: 'Could not read that file. Try again.' }` before any
  send.
- **`apps/mobile/src/app/share.tsx`** — `RequireAuth` + the "Send to" frame
  copied from `explore.tsx` (SafeAreaView, ChevronLeft IconButton). It shows a
  3-line text preview and/or "N files · first-name", `ChatPickerList` in
  single mode, and a full-width Send button disabled until a chat is picked or
  while sending. Send → `sendShare` → `resetShareIntent()` →
  `router.replace('/chat/[id]')`. A refused/missing share or a copy failure
  shows the fixed message (copy failure keeps the screen); Back/Close only
  reset the intent.
- No tests added (UI plus a thin store wrapper, per the spec).

### Checks run

- `pnpm install` (start of the task): `Done in 14.7s using pnpm v10.32.1`.
- `pnpm gate` from the repo root (re-run at the end of the fix round, after all
  finding commits):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.2s)
PASS  lint  (1.6s)
PASS  typecheck  (0.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- I ran no single test file, with any reporter: this change adds no tests, and
  the gate ran the `@zilar/mobile` tests. (Two earlier gate runs in the first
  round were red: the first on the Effect ratchet for the new files, the second
  on Effect v4 API/type errors; both are fixed. Every gate run in the fix round
  was green on its first attempt.)

### Round: fix after pre-review

- **Finding 1 (must-fix, Android handover): fixed.** Added `ShareIntentRedirect`
  to `apps/mobile/src/app/_layout.tsx`, inside `ShareIntentProvider`: on the
  transition to `hasShareIntent = true` it calls `router.push('/share')` once,
  skips the push when already on `/share`, and re-arms when the intent clears.
  This is the library's own expo-router pattern (`example/expo-router/app/index.tsx`),
  which the previous Report had misread. The `+native-intent` branch stays for
  the iOS `dataUrl` link.
- **Finding 2 (nit): fixed in the lead fix round below** (now escalated to a
  behaviour fix: empty and oversize files are refused on screen).
- **Finding 3 (nit): fixed in the lead fix round below** (now escalated: a
  defect can no longer leave Send disabled).
- **Tests added:** none. The fix is navigation/UI code, which the repo rules and
  the task spec exclude from tests; the finding names no test.
- **Gate:** `pnpm gate` → `GATE PASS` (see the block above: 5 changed files,
  install/format/lint/typecheck/effect/mobile tests all PASS, scope clean,
  400-line limit OK). The gate was re-run in the continuation session after the
  finding-1 commit, with a clean tree, and passed again with the same checks.
- **Not device-tested:** the redirect is reasoned from the library example; no
  Android build in this session, so the share-sheet handover itself is unverified
  on a phone.

### Round: lead fix round (security F1, nit 2, nit 3)

- **Item 1 (security, pre-review F1): fixed** in `133a94dd2`
  (`T-1895: share accepts file:// only from the app cache`). `share-send.ts`
  now pre-checks every path before any copy or send: `content://` is copied into
  `Paths.cache` as before; a `file://` uri is used only when it starts with
  `Paths.cache.uri`, and `..` segments are refused so a path cannot climb out of
  the cache root. Anything else resolves
  `{ ok: false, message: 'That file cannot be shared.' }` with nothing sent.
- **Item 2 (nit 2): fixed** in `9a5f6a509`
  (`T-1895: share refuses empty and oversize files on screen`). After the copy,
  each file is checked before the store is called: size `0` →
  `EMPTY_MESSAGE`, size over `MAX_ATTACHMENT_BYTES` → `TOO_LARGE_MESSAGE` (both
  imported from `attachment-common.ts`; the cap from `attachments.ts`). The
  screen now stays and shows the sentence instead of "succeeding" while the
  store refuses the file inline.
- **Item 3 (nit 3): fixed** in `b47a34898`
  (`T-1895: share send always re-enables Send`). `send()` maps every cause
  (`Effect.catchCause`) to `{ ok: false, message: 'Could not send. Try again.' }`
  and `Effect.ensuring` always runs `setSending(false)`, on success, typed
  failure or defect, so Send cannot stay disabled forever. Note: Effect 4.0.4
  has no `catchAllCause`; the API is `catchCause`.
- **Tests added:** none. The lead restricted this round to `share-send.ts`,
  `share.tsx` and this task file, so no test file could be touched; the gate ran
  the `@zilar/mobile` suite. I ran no single test with any reporter.
- **Gate** (run after the three item commits, before this Report edit):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (3.1s)
PASS  lint  (3.1s)
PASS  typecheck  (8.6s)
PASS  effect  (2.1s)
PASS  tests @zilar/mobile  (5.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead
- **Deviation from the literal signature:** `sendShare` is
  `Effect.fnUntraced(...)` returning an `Effect`, not `export async function`.
  The gate's Effect ratchet rejects a new file with `async`/`await`/`try` and
  a static `expo-file-system` import, so the new code follows the repo's
  Effect style; the screen calls `Effect.runPromise`. Its resolved value is the
  specified `{ ok: true } | { ok: false, message }`.
- **Cache copies are not deleted.** The real uploader (`attachment-uploader.ts`)
  opens the local file for the PUT after `sendAttachment` returns, and the
  store keeps the file for a retry/`retryAttachment`, so deleting it right after
  the send would break the upload. The OS clears the cache directory.
- **Not device-tested.** No phone/build in this task (that is share-plan task
  7), so the `content://` → cache copy and the Android share handover are not
  exercised on a device here. The code uses `new File(uri).copy(destination)`
  from `expo-file-system`, the same API family as `save-photo.ts`.
- **Share while logged out:** `RequireAuth` redirects to `/login`; the share
  payload lives only in the native module, and the pending-share holder from
  share-plan task 3 is not in this task's Allowed files, so surviving the login
  round-trip is not handled here.
- **Back with no history** (a cold start straight into `/share`) falls back to
  `/` after resetting the intent.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `3eb951742`.
- **The last packet was stale:** the 20:13 PREREVIEW was re-announced for the new head. The lead reviewed both fix rounds itself:
  - `ShareIntentRedirect` opens `/share` on an Android SEND;
  - `file://` is accepted only inside `Paths.cache` (with `..` refused), and `content://` is copied first;
  - empty or over-50 MB files are refused on screen;
  - Send is always re-enabled (`catchCause` + `ensuring`).
- **Emulator (mock build), text share:**
  - `am start -a SEND -t text/plain` on a warm app opens "Send to" with the text preview, and Send stays disabled until a chat is picked;
  - picking Ana then Send opens Ana's chat with the shared message sent.
- **Emulator, image share:** a `content://media/...` uri the app could not query **crashed the app inside `expo-share-intent`**. `getFileInfo` uses `query(...)!!`, an unchecked `moveToFirst()` and `getType(uri)!!` (`ExpoShareIntentModule.kt:69-75`), and 8.0.1 is the latest release. This is a library bug, not this diff. It's fixed by a `pnpm patch` in T-1908 before any release.

