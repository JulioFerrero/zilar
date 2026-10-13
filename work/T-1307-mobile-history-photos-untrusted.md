---
id: T-1307
title: "Mobile bug: after the app restarts, photos from chat history render as 'Not loaded: untrusted address' file cards instead of images — find the cause and fix it; tested"
status: merged
milestone: M5
branch: task/T-1307-mobile-history-photos-untrusted
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1307: History photos show as "untrusted" after a restart (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio reports many errors on the phone apps. Lead's repro (2026-10-13, 01:20), on the emulator with the release APK Julio's phone runs (main at `c2d1be1`, live server `https://chat.zilar.app`):
1. Open the DM, attach a gallery photo, send: the bubble shows the photo, with one tick.
2. Close the app (force-stop), reopen it, open the same DM.
3. **The same message is now a file card: "20.png, Not loaded: untrusted address"** (the row in `apps/mobile/src/components/chat/attachment-message.tsx:57-58`, rendered when the store's sanitizer downgraded the image to `kind: 'file'`, `packages/chat-core/src/media.ts:146-170`).

**Already checked by the lead, and not the cause:**
- **The token link:** mobile `locals.mediaToken` is the same object the shared lifecycle writes (`apps/mobile/src/store/real-store.ts:108-113`; `packages/client-core/src/store/lifecycle.ts:347-348` sets `ctx.mediaToken` from the XMPP token **before** connecting).
- **Load order:** previews load after connect (`packages/client-core/src/store/lifecycle.ts:397`).
- **The trust rule itself:** `trustedMediaHosts` adds the service host, the domain and `upload.<domain>` (`packages/chat-core/src/media.ts:60-74`); on live, both are `chat.zilar.app`, and uploads are `https://chat.zilar.app/upload/...` (`deploy/coolify/docker-compose.app.yml`, `EJABBERD_MACRO_UPLOAD_URL`).

So some path builds the message **without** the token, or with a token whose hosts don't match. Candidates to check:
- the mobile history loader (`apps/mobile/src/store/effects/history.ts`) and the shared one (`packages/client-core/src/store/history.ts`), and whether the ledger's `deps.mediaToken()` (`apps/mobile/src/store/effects/helpers.ts:43`) is read at the right time;
- a cached or sent copy that keeps a stale `kind: 'file'` once it's been downgraded;
- **React Native's `URL`**: `packages/chat-core/src/url.ts` uses `new URL()`; check that `.hostname` and `.protocol` really work on Hermes / RN 0.86 (mobile has no URL polyfill). If `isTrustedMediaUrl` returns false on device only, this is the cause.

### What to build
1. **Find the cause.** Prove it with a failing test first, in the nearest client-core or mobile store test (the message pipeline), that reproduces the restart path: a history or MAM load of an image attachment at `https://chat.zilar.app/upload/abc/20.png`, with the live-shaped token (`service: wss://chat.zilar.app/xmpp-ws/ws`, `domain: chat.zilar.app`), must keep `kind: 'image'`. If the cause is RN's `URL`, prove it with a small check that runs under the mobile test runner, or explain it with RN source refs, and fix `parseUrl` so it doesn't depend on `URL.hostname` (a strict regex parse of scheme and host is fine).
2. **Fix it.** Make the test pass. Web must keep working the same way.
3. In the Report, give the cause in one paragraph with `file:line`.

### Read first
`AGENTS.md`, the files above, and `packages/client-core/src/store/ledger-incoming.ts:139-145`.

### Allowed files
`packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/lib/*.ts`, `apps/mobile/src/components/chat/attachment-*.tsx`, `work/T-1307-mobile-history-photos-untrusted.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with the new failing-then-passing test.
- **The lead's check:** the same repro on the emulator with a release build shows the photo after a restart.

---

## Report (written by the worker when done)

### Cause (one paragraph)

`parseUrl` (old `packages/chat-core/src/url.ts:7-13`) built its result from the runtime's global `new URL(...)`. On a runtime with no usable `URL` the constructor throws, so `parseUrl` returned `undefined` for every URL: `trustedMediaHosts` (`packages/chat-core/src/media.ts:60-74`, `parseUrl(token.service)?.hostname`) then dropped the service host, `isTrustedMediaUrl` (`media.ts:82-88`, `parseUrl(url).hostname`) read the `https://chat.zilar.app/upload/...` photo as untrusted, `sanitizeIncomingAttachment` (`media.ts:146-176`) downgraded it to `kind: 'file'`, and the bubble painted the file card with `trusted={false}` (`apps/mobile/src/components/chat/attachment-message.tsx`). That is the exact runtime state the new device test reproduces (`URL = undefined`).

The precise on-device trigger is **not** proven, and the RN partial-`URL` hostname drop alone cannot produce the symptom: React Native's `URL` returns `''` from `hostname` for `wss://chat.zilar.app/xmpp-ws/ws` (`react-native@0.86.3 Libraries/Blob/URL.js:141-144`), but the live token's `domain` still adds `chat.zilar.app` to the trusted set (`media.ts:68-72`), so the `https://` photo URL stays trusted and `kind` stays `image`; Expo also installs a fuller `URL` (`expo/src/winter/url.ts`, `whatwg-url-minimum`) under which the old code worked. So the durable fix is that `parseUrl` no longer depends on whichever `URL` the runtime provides; the runtime state that produced Julio's report remains unconfirmed. The media sheet is unaffected because it reads the server's `/api/media` metadata (`apps/mobile/src/lib/media-api.ts:79-100`), not the ledger; web is unaffected because the browser `URL` is complete.

### Fix

Rewrote `parseUrl` (`packages/chat-core/src/url.ts`) as a strict regex parse of scheme / authority / path, with no dependency on the global `URL`. It returns a `ParsedUrl` (`protocol`, `hostname`, `origin`, `pathname`, `toString()`); http(s) behaviour is unchanged, and `wss://` (and other schemes) now yield their host on every runtime. All existing call sites (`media.ts`, `attachment-common.ts`, `topics.ts`, `gifs.ts`, `stickers.ts`, `save-photo.ts`, `markdown-inline.ts`, web `attachments.ts`, `MarkdownText.tsx`) only read those members, so no call site changed.

### Failing-then-passing test

`apps/mobile/src/lib/parse-url-device.test.ts` runs the live-shaped token (`service: wss://chat.zilar.app/xmpp-ws/ws`, `domain: chat.zilar.app`) and the photo `https://chat.zilar.app/upload/abc/20.png` through `parseUrl` / `trustedMediaHosts` / `isTrustedMediaUrl` / `sanitizeIncomingAttachment` with the runtime `URL` unavailable (`URL = undefined`: the condition the test can reproduce; the exact on-device trigger is unconfirmed, see the cause paragraph). Before the fix it **failed** (`parseUrl(service)` returned `undefined`, so the photo downgraded); after it **passes** and keeps `kind: 'image'`. I verified both directions by swapping the old and new `parseUrl`.

Also added `packages/chat-core/src/url.test.ts` (parser rules) and `packages/chat-core/src/media.test.ts` (trust rule), and a store regression test in `apps/mobile/src/store/real-store.history.test.ts` that loads the photo from history with the live token and asserts `kind: 'image'` plus `mediaTrustedHosts = {chat.zilar.app, upload.chat.zilar.app}`.

### Token path (checked; not the cause)

The lead's second note suggested a page loaded before the token. The token is set before any ingest: `connectXmpp` sets `ctx.mediaToken` at `packages/client-core/src/store/lifecycle.ts:347`, before `current.connect()` at `:384`, and history only loads while `status === 'online'` (`packages/client-core/src/store/history.ts:102-105`). I also ran a store test that opens the chat before the token promise resolves: the photo still comes back `kind: 'image'`. So the permanent downgrade is the `URL` read, not the token order; no re-sanitise-after-token step is needed once the URL parses.

### Commands run (real results)

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/url.test.ts src/media.test.ts` → 2 files, **15 passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/parse-url-device.test.ts src/store/real-store.history.test.ts` → 2 files, **9 passed**.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot` → 13 files, **143 passed** (one expected `ERROR … createXmpp is not provided in this test` log from the boot-failure case).
- `pnpm gate` → **GATE PASS**:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (0.7s)
PASS  tests @zilar/chat-core  (0.9s)
PASS  tests @zilar/mobile  (1.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Files changed

- `packages/chat-core/src/url.ts` — the fix.
- `packages/chat-core/src/url.test.ts` — new parser tests.
- `packages/chat-core/src/media.test.ts` — new trust-rule tests.
- `apps/mobile/src/lib/parse-url-device.test.ts` — new failing-then-passing check.
- `apps/mobile/src/store/real-store.history.test.ts` — added the restart regression test.
- `apps/mobile/src/lib/attachments.ts` — new `imageAttachmentRender` render-state helper (round 2, finding 2).
- `apps/mobile/src/lib/attachments.test.ts` — tests for the render-state helper (round 2, finding 2).
- `apps/mobile/src/components/chat/attachment-message.tsx` — the load-failure row and retry (round 2, finding 2).
- `work/T-1307-mobile-history-photos-untrusted.md` — this report.

### Deviations / open questions

- I did **not** change `sanitizeIncomingAttachment`'s downgrade rule or add a re-sanitise pass: with the URL parsed correctly the live token trusts the upload URL, so the downgrade no longer fires for `chat.zilar.app`. If the emulator check still shows the file card, please send the failing `attachment.url` (the token hosts and the upload host are all `chat.zilar.app` on live, so a URL outside them would be the missing fact), and note the secondary suspect below.
- Secondary suspect (now fixed in round 2, finding 2): the `AttachmentImage` fallback used to hard-code `trusted={false}` on a *load* failure, so an image whose fetch failed (`broken`) read as "untrusted address" with a dead card. The bubble now renders a "Couldn't load" row with a retry that re-attempts the fetch, distinct from the genuine untrusted case.
- Runtime note: Expo installs a fuller `URL` (`expo/src/winter/url.ts`, `whatwg-url-minimum`) that parses the live URLs correctly; React Native's own `URL` is the partial one. The fix makes the trust decision independent of which polyfill wins, which is what the spec asked for.

### Round (fix round 2)

Findings from `PREREVIEW.md`:

- **Finding 1 (should-fix, Report):** rewrote the "Cause" paragraph. It no longer presents the RN partial-`URL` hostname drop as the proven cause (the live token's `domain` still trusts the photo host, and Expo's fuller `URL` also worked), and now states that the `URL = undefined` runtime is the condition the device test reproduces while the exact on-device trigger is unconfirmed. The test paragraph's parenthetical was aligned with this.
- **Finding 2 (should-fix, code):** `attachment-message.tsx` no longer labels a trusted image whose inline fetch failed as "Not loaded: untrusted address" with a dead card. The render decision is extracted to `imageAttachmentRender` (`apps/mobile/src/lib/attachments.ts`, a pure helper), which maps a trusted + broken image to `load-failed`; the bubble then shows `AttachmentFileRow` with a new `loadFailed` prop ("Couldn't load") and a "Retry loading" action that resets `broken`, re-attempting the fetch. The genuine untrusted branch is unchanged.
- **Finding 3 (nit):** not touched (outside the changed lines; the review itself scopes it out).
- **Disagreements:** none.

Tests added (finding 2): `apps/mobile/src/lib/attachments.test.ts` covers all four `imageAttachmentRender` outcomes, including the regression that trusted + broken is `load-failed`, not `untrusted`. No component render test: AGENTS.md says UI code gets no tests, and the review's fix is a pure decision that the extracted helper now covers.

Single tests run this round: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/attachments.test.ts src/lib/parse-url-device.test.ts src/store/real-store.history.test.ts` → 3 files, **13 passed**.

`pnpm gate` after the fixes → **GATE PASS**:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/chat-core  (0.8s)
PASS  tests @zilar/mobile  (1.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round (fix round 3)

Findings from `PREREVIEW.md` (round 2):

- **Finding 1 (must-fix, code):** fixed the backslash parser differential. `parseUrl` (`packages/chat-core/src/url.ts`) now returns `undefined` for an authority-scheme URL (`http:`, `https:`, `ws:`, `wss:`, `ftp:`) whose text contains a `\`, failing closed to match the fetch layer (WHATWG `URL` / OkHttp treat `\` as `/`). Verified the pre-fix parser read `chat.zilar.app` as the host of `https://evil.test\@chat.zilar.app/x` while WHATWG `new URL(...).hostname` is `evil.test`; with the guard, `parseUrl` returns `undefined`, so `isTrustedMediaUrl` is `false` and `sanitizeIncomingAttachment` downgrades the peer's image to a `kind: 'file'` card (no auto-fetch).
- **Finding 2 (nit):** not touched — `splitHostPort` is not in a line this round changes.
- **Disagreements:** none.

Tests added for finding 1:
- `packages/chat-core/src/url.test.ts`: `parseUrl` returns `undefined` for `https://evil.test\@chat.zilar.app/x`, `https://chat.zilar.app\evil.test/x` and `wss://chat.zilar.app\xmpp-ws/ws`.
- `packages/chat-core/src/media.test.ts`: `isTrustedMediaUrl` rejects `https://evil.test\@chat.zilar.app/x`, and `sanitizeIncomingAttachment` downgrades it to `file`.

Single tests run this round: `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/url.test.ts src/media.test.ts` → 2 files, **18 passed**.

`pnpm gate` after the fix → **GATE PASS**:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (3.2s)
PASS  format  (5.1s)
PASS  lint  (2.0s)
PASS  typecheck  (8.2s)
PASS  effect  (4.3s)
PASS  tests @zilar/chat-core  (2.1s)
PASS  tests @zilar/mobile  (9.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-13: approved as hardening. The real cause is a server bug, now T-1315.** Pre-review clean after 2 auto rounds.
- **The lead found the cause live** (read-only, Julio's browser): `GET /api/files` answers **502 `file_unavailable`** for the photo, while the same `/upload/` URL fetched directly is 200 `image/png`. Mobile loads every chat file through `/api/files` (T-1185). When the load failed, the old bubble set `broken` and fell back to the file row with `trusted={false}`, which is where "Not loaded: untrusted address" came from. The fix is T-1315 (the internal fetch's Host).
- **What this task adds:**
  - `parseUrl` no longer depends on the runtime's `URL`, and fails closed on backslash host tricks;
  - a trusted image that fails to load shows "Couldn't load" with a retry, never the untrusted label.
- **Lead's checks after the rebase:**
  - chat-core: 89 tests pass; client-core: 150; mobile (`parse-url-device` + `src/store`): 48; web (`src/lib` + `src/store`): 53;
  - tsc: 0 errors on web, mobile and server; `url.ts` is 112 lines.
