---
id: T-1106
title: "Android App Links: https://chat.zilar.app links open the Zilar app (intent filter + assetlinks.json + web→app path rewrite)"
status: merged
milestone: M5
branch: task/T-1106-android-app-links
model: auto
effort: default
depends_on: [T-1103]
estimate: 0.3 day
---

# T-1106: `chat.zilar.app` links open the app

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: "make sure all chat.zilar.app links open in the app".

**What the lead read:**
- **The app config:** `apps/mobile/app.json` has `"scheme": "zilar"` (`:8`) and `android.package` `app.zilar.chat` (`:14`), with no `intentFilters`. iOS has only `bundleIdentifier` (`:10-11`).
- **The web paths** (`apps/web/src/routes/AppRoutes.tsx:110-247`): `/invite/:code`, `/j/:token`, `/login`, `/c/:chatJid`, `/settings/<page>`, `/u/:handle`, `/:atHandle` (a `@handle`) and `/`.
- **The mobile routes** (`apps/mobile/src/app/`): `invite/[code]`, `join/[token]`, `login`, `chat/[id]` (the id is the chat JID, the same value as web's `:chatJid`), `settings/<page>` (approvals, blocked, connections, folders, integrations, machines, profile, requests, stickers), `u/[handle]`, `at/[handle]` and `(tabs)`. There is no `+native-intent.tsx`.
- **The release APK's signing certificate,** read by the lead with `apksigner verify --print-certs`, is SHA-256 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. This is the standard Expo debug key the sideload build uses (`docs/RELEASING.md` §7).
- **The web container:** `apps/web/Caddyfile` serves real files before the SPA fallback (`try_files {path} /index.html`). Vite copies `apps/web/public/` to the site root.

### What to build
1. **`apps/mobile/app.json`:** add `android.intentFilters` with one entry:
   - `"action": "VIEW"` and `"autoVerify": true`;
   - `"category": ["BROWSABLE", "DEFAULT"]`;
   - `"data"`, one object per path prefix: `{ "scheme": "https", "host": "chat.zilar.app", "pathPrefix": … }` for `/c/`, `/invite/`, `/j/`, `/u/`, `/settings/` and `/@`. Also add `{ "scheme": "https", "host": "chat.zilar.app", "path": "/" }`.
   - Leave `/login`, `/setup` and `/welcome` out, so a browser sign-in keeps working.
2. **A new `apps/web/public/.well-known/assetlinks.json`:** the standard Digital Asset Links statement for `android_app` with `package_name` `app.zilar.chat`, the `sha256_cert_fingerprints` value above and the relation `delegate_permission/common.handle_all_urls`.
3. **A new `apps/mobile/src/app/+native-intent.tsx`,** the expo-router `redirectSystemPath({ path, initial })` hook. It turns a `https://chat.zilar.app/...` path (or a bare web path) into the app route:
   - `/c/<jid>` → `/chat/<jid>`, keeping the URL encoding;
   - `/j/<t>` → `/join/<t>`;
   - `/invite/<c>` and `/u/<h>` stay as they are;
   - `/@<h>` → `/at/<h>`;
   - `/settings/<p>` → `/settings/<p>` when `<p>` is one of the mobile settings pages, else `/settings`;
   - `/` → `/`;
   - **anything else** → `/`;
   - `zilar://` deep links pass through unchanged.

   Keep the mapping a small pure function in `apps/mobile/src/lib/web-link.ts` (`webPathToAppPath`), so it reads clearly. It has **no tests**: it is UI routing, not a crucial area.
4. **Proof in the Report:**
   - `node -e` or `tsx` output of `webPathToAppPath` for each case above;
   - `cat apps/web/public/.well-known/assetlinks.json | node -e "JSON.parse(require('fs').readFileSync(0))" && echo valid`.
   - The lead builds the APK and checks on the phone with `adb shell am start -a android.intent.action.VIEW -d https://chat.zilar.app/c/...`, and on the live site once deployed.
5. **iOS universal links are out of scope:** they need an Apple Team ID and a paid account (`docs/RELEASING.md` §8 uses a free account). Say so in the Report.
6. **No other files change.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/app.json`, `apps/web/src/routes/AppRoutes.tsx:105-250`, `apps/mobile/src/app/_layout.tsx`, and the expo-router `+native-intent` docs (the version in `apps/mobile/package.json`).

### Allowed files
`apps/mobile/app.json`, `apps/web/public/.well-known/assetlinks.json`, `apps/mobile/src/app/+native-intent.tsx`, `apps/mobile/src/lib/web-link.ts`, `work/T-1106-android-app-links.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 4.

---

## Report (written by the worker when done)

### What I did

1. **`apps/mobile/app.json`** — added `android.intentFilters` with one `VIEW` filter, `autoVerify: true`, `category: ["BROWSABLE", "DEFAULT"]`, and `data` entries for `https://chat.zilar.app` prefixes `/c/`, `/invite/`, `/j/`, `/u/`, `/settings/`, `/@`, plus an exact `path: "/"`. `/login`, `/setup` and `/welcome` are left out.
2. **`apps/web/public/.well-known/assetlinks.json`** (new) — Digital Asset Links statement for `android_app` `app.zilar.chat` with the release APK's SHA-256 fingerprint and relation `delegate_permission/common.handle_all_urls`.
3. **`apps/mobile/src/lib/web-link.ts`** (new) — pure `webPathToAppPath(input)` with two modes (see the fix round below): a full `https://chat.zilar.app` URL keeps the web-to-mobile mapping (`/c/<jid>` → `/chat/<jid>` raw, `/j/<t>` → `/join/<t>`, `/invite/<c>` and `/u/<h>` unchanged, `/@<h>` → `/at/<h>`, `/settings/<p>` → `/settings/<p>` for the nine mobile pages else `/settings`, anything unknown → `/`), while a bare path is only rewritten for the web-only `/c/`, `/j/` and `/@` forms and any other bare path is returned unchanged. Query strings are kept. `zilar://` links pass through unchanged. No dependencies added.
4. **`apps/mobile/src/app/+native-intent.tsx`** (new) — exports `redirectSystemPath({ path })` delegating to `webPathToAppPath`.

No tests: this is UI routing, per the spec. All files are well under 400 lines.

### Changes outside the spec

The first version of `web-link.ts` used `new URL()` inside a `try/catch`. `pnpm gate`'s Effect ratchet (W4) flagged the new file as "needs Effect" because of the `try {`. I rewrote the origin parsing with a regex (`^https?:\/\/([^/?#]+)([^?#]*)`) so the file has no `try/catch`; behaviour is unchanged (verified below). No Effect dependency is required for pure routing.

### Commands and results

- `pnpm install` — Done in 12s.
- JSON validity:
  - `node -e "JSON.parse(...apps/mobile/app.json)"` → `app.json valid`
  - `cat apps/web/public/.well-known/assetlinks.json | node -e "JSON.parse(...)" && echo valid` → `valid`
- `webPathToAppPath` proof (`node_modules/.bin/tsx -e ...`, real output):

  ```
  "https://chat.zilar.app/c/room%40conf.localhost" -> "/chat/room%40conf.localhost"
  "https://chat.zilar.app/j/abc123"               -> "/join/abc123"
  "https://chat.zilar.app/invite/XYZ"             -> "/invite/XYZ"
  "https://chat.zilar.app/u/julio"                -> "/u/julio"
  "https://chat.zilar.app/@julio"                 -> "/at/julio"
  "https://chat.zilar.app/settings/machines"      -> "/settings/machines"
  "https://chat.zilar.app/settings/ais"           -> "/settings"
  "/c/room%40conf.localhost"                      -> "/chat/room%40conf.localhost"
  "https://chat.zilar.app/"                       -> "/"
  "https://example.com/nope"                      -> "/"
  "zilar://chat/123"                              -> "zilar://chat/123"
  "https://chat.zilar.app/c/1?x=2"                -> "/chat/1"
  ```

- `pnpm gate` (from the repo root, after the fix round), summary lines:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (3.3s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (2.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  The 5 changed files are the four above plus this task file — all in the Allowed files.

### Fix round (lead review)

**Problem:** `redirectSystemPath` can receive a bare path (expo-router sometimes hands one over without the scheme) such as `/chat/x`, `/group/g1`, `/settings/sticker-pack?id=p1`, `/at/ana`, `/ais/new` or `/explore`. The old `rewriteWebPath` sent every one of those to `/`, which broke existing `zilar://` deep links, and the `[^/]+$` page check failed on `/settings/sticker-pack?id=…` because of the query.

**Fix (in `web-link.ts`, header comment updated):**
- A bare path (starts with `/`) is now rewritten **only** for the web-only forms `/c/<jid>` → `/chat/<jid>`, `/j/<t>` → `/join/<t>` and `/@<h>` → `/at/<h>`; every other bare path is returned unchanged, query included.
- A full `https://chat.zilar.app/...` URL keeps the previous mapping (unknown → `/`, settings checked against `SETTINGS_PAGES`), but the query string is now kept (`/c/1?x=2` → `/chat/1?x=2`), and the settings page name is matched before any `?` (the path and query are split first).
- `zilar://` is still returned unchanged.

**Proof (`node_modules/.bin/tsx -e ...`, real output):**

```
"/chat/a%40b"                              -> "/chat/a%40b"
"/group/g1"                                -> "/group/g1"
"/settings/sticker-pack?id=p1"             -> "/settings/sticker-pack?id=p1"
"/at/ana"                                  -> "/at/ana"
"/ais/new"                                 -> "/ais/new"
"/explore"                                 -> "/explore"
"/c/a%40b"                                 -> "/chat/a%40b"
"/j/tok"                                   -> "/join/tok"
"/@ana"                                    -> "/at/ana"
"https://chat.zilar.app/c/a%40b?x=2"       -> "/chat/a%40b?x=2"
"https://chat.zilar.app/settings/stickers" -> "/settings/stickers"
"https://chat.zilar.app/settings/nope"     -> "/settings"
"https://chat.zilar.app/login"             -> "/"
"https://chat.zilar.app/"                  -> "/"
"zilar://settings/sticker-pack?id=p1"      -> "zilar://settings/sticker-pack?id=p1"
"https://evil.example/c/x"                 -> "/"
```

Two commits: `T-1106: keep bare app-route paths and queries in webPathToAppPath` (the fix), then this Report.

### Device verification (for the lead)

I did not build the APK or run on a phone; that step is the lead's. Suggested checks from the spec: build the release APK, then `adb shell am start -a android.intent.action.VIEW -d https://chat.zilar.app/c/...`, and once deployed hit the live site and confirm `https://chat.zilar.app/.well-known/assetlinks.json` is served (Caddy serves real files before the SPA fallback, so the static file wins).

### iOS

iOS universal links are out of scope: they need an Apple Team ID and a paid developer account, while `docs/RELEASING.md` §8 uses a free account.

## Review (written by Claude)

**Lead, 2026-10-11: approved after one fix round. The pre-review is clean, with 1 nit.**
- **The change:**
  - `app.json` gets a verified intent filter for `https://chat.zilar.app` (`/c/`, `/invite/`, `/j/`, `/u/`, `/settings/`, `/@` and `/`);
  - `apps/web/public/.well-known/assetlinks.json` names `app.zilar.chat` with the sideload key's SHA-256 (the lead read it with `apksigner`);
  - `+native-intent.tsx` calls `webPathToAppPath` (`apps/mobile/src/lib/web-link.ts`).
- **The fix round:** a bare path now keeps every in-app route and its query; only `/c/`, `/j/` and `/@` are rewritten. A full `chat.zilar.app` URL keeps its query.
- **The lead ran 18 cases on the branch, all as expected:**
  - `/chat/a%40b`, `/group/g1`, `/settings/sticker-pack?id=p1`, `/at/ana`, `/ais/new` and `/explore` are unchanged;
  - `/c/a%40b` → `/chat/a%40b`, `/j/tok` → `/join/tok`, `/@ana` → `/at/ana`;
  - `https://chat.zilar.app/c/a%40b?x=2` → `/chat/a%40b?x=2`;
  - known and unknown settings pages, `/login` → `/`, a foreign host → `/`, and `zilar://` passes through.
- **The nit, accepted:** an unknown settings page drops its query.
- **iOS universal links are out of scope** (they need a paid Apple account). The lead's phone check comes with the next APK.
- **Check:** the gate passed.
