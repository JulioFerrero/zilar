---
id: T-2029
title: "Share W1-m: one sanitizeMediaItems rule in client-core (an image or gif on an untrusted host loses its url so the media panel never auto-loads it; the phone resolves relative /api/media URLs first) — web and phone pins effects use it — net fewer lines, with tests"
status: merged
milestone: M5
branch: task/T-2029-shared-media-sanitise
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2029: Shared media-panel sanitising (share plan W1-m)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` (§ "pins" in the wiring table, line 515, and slice **W1-m**) found the media panel's tracker-image rule written twice. The rule is that an image from an untrusted host never auto-loads. It's a security rule, so tests are required.

### Facts (read by the lead on 2026-10-18 at `edd895b02`)
- **Web.** `apps/web/src/store/effects/pins.ts` (118 lines):
  - `sanitizeMediaPage(ctx, page)` (`:41-61`) builds `trustedMediaHosts(ctx.mediaToken)`;
  - for `image` or `gif` items with no url, no trusted set, or an untrusted url, it drops `url`;
  - `loadChatMedia` (`:64-80`) calls `api.listChatMedia({ chat, type: tab, before? })` and sanitises.
- **Phone.** `apps/mobile/src/store/effects/pins.ts` (218 lines):
  - `sanitizeMediaItem(item)` (`:134-151`) first resolves the url with `resolveMediaUrl(item.url, API_URL)`;
  - it drops `url` for an untrusted `image` or `gif`, and otherwise returns the item with the **resolved** url;
  - `loadChatMedia` (`:188-203`) calls `mediaApi.listChatMedia` with the same request shape.
- **The shared home.** `packages/client-core/src/store/pins.ts` (202 lines) already holds the shared pins helpers, and the store barrel exports it (`store/index.ts:46`).

### Steps
1. **The shared function.** Add to `packages/client-core/src/store/pins.ts`:
   `sanitizeMediaItems(items, isTrusted: ((url: string) => boolean) | undefined, resolve?: (url: string) => string)`.
   - It resolves the url first when `resolve` is given.
   - An `image` or `gif` with no url, with `isTrusted` undefined, or whose resolved url fails `isTrusted`, loses `url`.
   - Other kinds keep the resolved url.
   - The file must stay at or under 400 lines.
2. **Web.** `apps/web/src/store/effects/pins.ts` uses it, with `isTrusted` built from `trustedMediaHosts(ctx.mediaToken)`, or undefined when there's no token. Delete `sanitizeMediaPage`.
3. **Phone.** `apps/mobile/src/store/effects/pins.ts` uses it, with `isTrusted = (u) => isTrustedMediaUrl(u, s.mediaTrustedHosts)` and `resolve = (u) => resolveMediaUrl(u, API_URL)`. Delete `sanitizeMediaItem`.
4. **Tests** in a new `packages/client-core/src/store/pins.test.ts`:
   - a foreign-host image loses `url`;
   - a trusted image keeps it;
   - a file item on a foreign host keeps its url;
   - with no trust function, every image loses `url`;
   - a relative url is resolved before the check.
5. **Fewer lines.** Product lines across the three files must go down, against 538 today. Put the before and after counts in the Report.

### Allowed files
- `packages/client-core/src/store/pins.ts`
- `packages/client-core/src/store/pins.test.ts`
- `apps/web/src/store/effects/pins.ts`
- `apps/mobile/src/store/effects/pins.ts`
- `work/T-2029-shared-media-sanitise.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/pins.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did

- Added `sanitizeMediaItems(items, isTrusted, resolve?)` to
  `packages/client-core/src/store/pins.ts`. It resolves a url first when
  `resolve` is given, then drops `url` from an `image` or `gif` with no url, no
  trust function, or a resolved url that fails `isTrusted`. Other kinds keep the
  resolved url.
- Web (`apps/web/src/store/effects/pins.ts`) now calls it with a trust function
  built once from `trustedMediaHosts(ctx.mediaToken)`, or `undefined` when there
  is no token. `sanitizeMediaPage` is gone.
- Phone (`apps/mobile/src/store/effects/pins.ts`) now calls it with
  `isTrusted = (u) => isTrustedMediaUrl(u, s.mediaTrustedHosts)` and
  `resolve = (u) => resolveMediaUrl(u, API_URL)`. `sanitizeMediaItem` is gone;
  `resolveMediaUrl` stays (it is only defined in this file).
- New `packages/client-core/src/store/pins.test.ts` covers the five cases in
  the spec: foreign-host image loses `url`, trusted image keeps it, foreign-host
  file keeps its url, no trust function drops every image url, and a relative
  url is resolved before the check.

Product lines (the three source files, excluding the new test): **538 before →
534 after** (`client-core` 202→225, web 118→106, mobile 218→203).

### Checks run

- `pnpm install`: Done in 16.9s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/pins.test.ts`:
  1 file passed, 5 tests passed.
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (1.1s)
PASS  typecheck  (5.0s)
PASS  effect  (0.9s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/client-core  (8.5s)
PASS  tests @zilar/mobile  (2.2s)
PASS  tests @zilar/web  (4.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Behaviour is unchanged on both apps: web still does not resolve urls (it
  passes no `resolve`), and phone still resolves before checking.
- One harmless identity difference: a row with no `url` now comes back as a
  copy without the `url` property instead of the same object. No visible effect.
- The shared function's type is structural (`{ kind: string; url?: string }`), so
  both apps' `MediaItem` types satisfy it without a shared import.


## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.** One `sanitizeMediaItems` in client-core `store/pins.ts`.
  - It resolves the url first (the phone passes `resolveMediaUrl`).
  - It drops the url of any image or gif that isn't trusted, and of any image or gif when there's no trust set yet.
  - Other kinds keep their url.
- **Behaviour** is the same as both old copies.
- **Size.** Product lines went from 538 to 534. The value is the one tested security rule rather than the size.
