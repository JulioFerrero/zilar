# Share into Zilar

Plan for MUX-19 (`docs/audit/findings-sweep-client.md:37`): put Zilar in the
Android share sheet first, then iOS. Researched 2026-10-17 for Expo 57 /
React Native 0.86; docs only, no code.

**Recommendation:** add [`expo-share-intent`](https://github.com/achorein/expo-share-intent)
8.0.1 (the SDK 57 release), hand the payload to a new `/share` route, reuse the
forward sheet's chat list, and send through the existing `sendText` /
`sendAttachment` store actions. One native/config step needs Julio's OK.

## 1. The library

`expo-share-intent` **8.0.1** is the current npm `latest` (checked 2026-10-17).
Its peer range is `expo ^57`, `expo-linking >=57.0.1`, `expo-constants
>=57.0.3`; the README's version table maps SDK 57 to 8.0+. We already have
expo `~57.0.25` (`apps/mobile/package.json:33`), `expo-linking ~57.0.11`
(`:46`) and `expo-constants ~57.0.19` (`:36`), so it adds one dependency and no
version bump. It is maintained (8.x is the SDK 56/57 line; issues and releases
are active on GitHub).

What it adds to `app.json` (plugin options from the README and
`plugin/src/types.ts`):

```json
[
  "expo-share-intent",
  {
    "androidIntentFilters": ["*/*"],
    "androidMultiIntentFilters": ["image/*", "video/*"],
    "iosActivationRules": {
      "NSExtensionActivationSupportsText": true,
      "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
      "NSExtensionActivationSupportsWebPageWithMaxCount": 1,
      "NSExtensionActivationSupportsImageWithMaxCount": 10,
      "NSExtensionActivationSupportsFileWithMaxCount": 5
    }
  }
]
```

The plugin appends `SEND` / `SEND_MULTIPLE` filters to the existing manifest and
leaves our `VIEW` App Links alone (`apps/mobile/app.json:23-39`). The scheme it
uses is already set (`"scheme": "zilar"`, `app.json:8`). Default activation is
text + URL only; the block above adds images and files.

**It needs a new native build.** The package is a native module; Expo Go cannot
load it and an OTA JS update cannot add it (README "Expo Go?"). Build an APK from
`expo prebuild --clean` + `expo run:android` (or EAS) after the change. This is
why the dependency step is separate and marked "needs Julio".

**Fallback if 8.0.1 misbehaves on RN 0.86:** write a small config plugin that
adds the same `SEND`/`SEND_MULTIPLE` filters plus a local Expo module (the repo
already carries one: `apps/mobile/modules/zilar-whistle`) that reads the
activity intent and copies `content://` bytes into the cache. `+native-intent.tsx`
alone is not enough: Android delivers a share to the activity, not as a URL, so
some native code is unavoidable either way. The library is that code, already
tested on both platforms.

## 2. What arrives

The hook/provider exposes (`build/ExpoShareIntentModule.types.d.ts`, README
"Share intent content"):

| field | value |
| --- | --- |
| `type` | `text`, `weburl`, `media` (all files are image/video), `file`, or `null` |
| `text` | raw shared text, or the URL string for a link share |
| `webUrl` | the first http(s) link extracted from `text`, else `null` |
| `files` | array of `{ path, mimeType, fileName, size, width, height, duration }`, or `null` |
| `meta` | optional `{ title, ...open-graph }`, Android and iOS web pages |

`size` is `null` when the other app does not report it. On Android `path` falls
back to the provider's `content://...` URI when the library has no copied file
(`build/utils.js`, `parseShareIntent`); on iOS it is the app-group copy. Our
uploader takes a `file://` path (`apps/mobile/src/lib/attachment-uploader.ts:26`),
so `content://` must be copied into the cache first (task 5).

Delivery:

- **Cold start.** The root `ShareIntentProvider` mounts, reads the native
  module (Android activity intent) or the `zilar://dataUrl=zilarShareKey` link
  (iOS), and `hasShareIntent` becomes true.
- **Already running.** Android re-reads the intent when the app becomes active;
  iOS gets a new linking URL. Both surface through `onChange`, so the context
  re-renders.
- **Routing.** `apps/mobile/src/app/+native-intent.tsx:7-9` is expo-router's
  pre-router hook. Add one branch before `webPathToAppPath`: if the path
  contains `dataUrl=${getShareExtensionKey()}` return `/share`; otherwise keep
  the current behaviour (the library's own expo-router example does exactly
  this). The provider then makes the payload available on that route.

## 3. The flow

```
share sheet → +native-intent → /share → normalize (zod) → pending share (memory)
  → chat picker → tap Send → sendText | sendAttachment → reset + open the chat
```

- **Route.** New `apps/mobile/src/app/share.tsx`, wrapped in `RequireAuth`
  (`apps/mobile/src/auth/RequireAuth.tsx:41`). It renders the picker with the
  shared preview (text, or file names/thumbnails).
- **Picker.** `forwardTargets` already encodes the rules: no archived chats, no
  channels where the viewer cannot post, search over title and group
  (`apps/mobile/src/components/chat/forward-sheet.tsx:37-51`), with the rows at
  `:106-138`. Extract filter + rows into
  `apps/mobile/src/components/chat/chat-picker-list.tsx`; `ForwardSheet` keeps
  its multi-select behaviour, `/share` uses single-select. Single target is
  deliberate: every target re-uploads the file (one slot + PUT per message,
  `packages/client-core/src/store/send/attachment.ts:71-80`).
- **Text and links.** `sendText(chatId, text)` (`apps/mobile/src/store/types.ts:148`);
  the core trims and ignores empty text (`packages/client-core/src/store/send/text.ts:15`).
  A link is just text: keep the whole shared `text` (it may carry a comment
  around the URL), not only `webUrl`.
- **Images and files.** Map `ShareIntentFile` to `PickedFile`
  (`apps/mobile/src/lib/attachment-ports.ts:11-21`) and call
  `sendAttachment(chatId, file, { caption })` (`types.ts:152`). If the share
  contains both text and files, the text becomes the caption of the first file.
  The store upserts an optimistic bubble, then the existing pipeline requests
  a XEP-0363 slot (`packages/xmpp-core/src/namespaces.ts:14`), PUTs the bytes
  (`apps/mobile/src/store/effects/ports-media.ts:76-103`) and sends the
  attachment payload. Everything downstream (history, media sheet, push) works
  unchanged.
- **Caps.** 50 MB per file is enforced twice client-side: `MAX_ATTACHMENT_BYTES`
  (`apps/mobile/src/lib/attachments.ts:25`) and the store guard
  (`apps/mobile/src/store/effects/send.ts:131-146`). The upload port stats the
  file when the picker did not report a size and refuses if it cannot read it
  (`ports-media.ts:83-93`). The server cap is ejabberd `max_size: 52428800`
  (`infra/ejabberd/ejabberd.yml:199`, bare metal `deploy/baremetal/ejabberd.yml:239`).
  Reads go through `GET /api/files`, session- and membership-checked and rate
  limited at 600/min (`apps/server/src/files/api.ts:36-37,185`).
- **Cancel.** `resetShareIntent()`, drop the pending share, delete any copied
  cache file, go back. No slot request, no message, no bubble.
- **Send.** The picker's Send button is the only call to the store; closing the
  sheet or backing out never sends.
- **Logged out.** `RequireAuth` redirects to `/login?from=/share`
  (`apps/mobile/src/auth/RequireAuth.tsx:56-58`,
  `apps/mobile/src/auth/guard.ts:24-25`), and `AuthFlow` returns to `from`
  (`apps/mobile/src/auth/AuthFlow.tsx:41,110-116`). The share payload lives in memory in
  the root provider, so it survives the in-app login and `/share` resumes with
  the same item. If Android kills the process, the native module still holds the
  intent until it is cleared, so the cold-start path re-reads it.

## 4. Security

Shared content is untrusted input from another app.

- **Validate at the boundary.** `parseShareIntent` only JSON-parses; wrap the
  result in a zod schema in `lib/share-intent.ts`: bounded `text` (32 KiB),
  bounded `fileName` (255), `mimeType` matches `^[\w.+-]+/[\w.+-]+$`, at most
  10 files, and each `path` must start with `file://` or `content://`. Anything
  else is rejected with a fixed sentence, never rendered or fetched.
- **Paths stay local.** Accept `content://` (copy into the app cache, then use
  the copy) and `file://` only under the app cache or app-group directory;
  reject any other `file://` path instead of opening it.
- **Cap before any request.** Stat every file whose `size` is null; refuse
  `0` and anything over 50 MB before requesting a slot, with the existing fixed
  messages (`apps/mobile/src/lib/attachment-common.ts:14-15`). Never read a
  large file into memory: stream/copy, then PUT.
- **No auto-send.** A share may open `/share`, but only a tap on the picker's
  Send button sends. No background send, no "send to last chat".
- **No data leaks.** Do not log text, file names or paths; audit entries carry
  ids only. The upload PUT carries the slot's headers only; the bearer is
  reserved for our own API origin (`attachment-common.ts:46-66`).
- **Clean up.** Delete the cache/app-group copy after send or cancel. Reset the
  native intent on cancel so returning to the app does not replay it.
- **Deep links.** Only `dataUrl=zilarShareKey` on our scheme routes to
  `/share`; every other path keeps the existing web-path mapping.

## 5. iOS

The same package covers iOS: its config plugin adds a **separate share
extension target** (`ShareExtension`, bundle id
`app.zilar.chat.share-extension`) with `NSExtensionActivationRules`, and the
app group `group.app.zilar.chat` to pass files to the host app
(`plugin/src/ios/constants.ts`). No second library is needed.

Extra work versus Android:

- A native iOS build (EAS) with the extension target; EAS asks for the
  extension's credentials, and there must be exactly one extension target
  (README "iOS Extension Target"; Expo app-extensions docs:
  <https://docs.expo.dev/build-reference/app-extensions/>).
- `ios/` is generated and not committed, so `expo prebuild --clean` must run in
  the build.
- Test on a device from Photos, Safari and Files, including a multi-image
  share. iOS is a **later phase**; the `/share` route and send path are shared
  with Android, so only the native target and smoke test are new.

## 6. Ordered tasks

Each is ≤ 45 worker minutes. Task 1 is the only one that changes `app.json`
and dependencies, so it is marked **needs Julio**.

| # | Task | Files | Est. |
| --- | --- | --- | --- |
| 1 | **Native/config: needs Julio.** Add `expo-share-intent@8.0.1`, the plugin block above, `ShareIntentProvider` above `ChatStoreProvider`, and the `dataUrl` branch in `+native-intent`. Build one APK and confirm Zilar appears in the share sheet. | `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/+native-intent.tsx` | 45 |
| 2 | Pure payload parser: `ShareDraft` type, zod schema, `ShareIntent` → draft mapping (text vs files, size null), unit tests for hostile and empty payloads. | `apps/mobile/src/lib/share-intent.ts`, `apps/mobile/src/lib/share-intent.test.ts` | 30 |
| 3 | Pending-share holder: in-memory store that survives `/login` navigation, with `set` / `take` / `clear`; no disk persistence. | `apps/mobile/src/lib/pending-share.ts`, `apps/mobile/src/lib/pending-share.test.ts` | 25 |
| 4 | `/share` route: `RequireAuth`, preview, empty and error states, "Send to" title; no sending yet. | `apps/mobile/src/app/share.tsx` | 35 |
| 5 | Picker: extract `forwardTargets` + rows from `ForwardSheet` into `ChatPickerList`, single-select for `/share`, keep forward multi-select and its tests green. | `apps/mobile/src/components/chat/chat-picker-list.tsx`, `apps/mobile/src/components/chat/forward-sheet.tsx`, `apps/mobile/src/app/share.tsx` | 45 |
| 6 | Send path: `content://` → cache copy, size stat and 50 MB/empty refusal, `sendText` / `sendAttachment` with caption, reset intent and navigate to the chat; cache cleanup. | `apps/mobile/src/lib/share-send.ts`, `apps/mobile/src/lib/share-send.test.ts`, `apps/mobile/src/app/share.tsx` | 45 |
| 7 | Phone smoke (needs Julio's phone): fresh APK; share text, link, one photo, three photos, a PDF and an oversized file from Chrome / Files / Photos; cancel; logged out then login; confirm the message arrives and no duplicate on resume. Record results in the task file. | — | 30 |
| 8 | iOS phase (needs Julio): iOS activation rules and extension credentials, EAS build with the extension target, device smoke from Photos/Safari/Files. | `apps/mobile/app.json` | 45 |

Notes for the lead: task 1 is the release-blocking native change; 2–6 are pure
JS and can ship in the same APK. MUX-19 can be marked fixed only after task 7.
