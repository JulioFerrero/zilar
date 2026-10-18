---
id: T-2023
title: "Share W1-l: sticker recents and the token-bearing sticker-file URL check move to chat-core (URL always resolved with new URL, so '..' can't escape /api/stickers) — web and phone use them — net fewer lines, with tests"
status: merged
milestone: M5
branch: task/T-2023-shared-sticker-recents
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2023: Shared sticker recents and file-URL check (share plan W1-l)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. The share plan (`docs/audit/share-plan.md` §2.20 and slice **W1-l**) found the sticker recents and the sticker file-URL rule written twice.
- **The phone's copy has a bug.** It checks a relative path as a raw string, so `/api/stickers/../auth/file` passes, and the phone then adds the user's bearer token to that request.
- **Tests are required** for this token-bearing URL rule.

### Facts (from `docs/audit/share-plan.md` §2.20, read by the lead on 2026-10-18)
- **The same in both apps:**
  - the recents key and the cap of 30 (web `apps/web/src/lib/stickers.ts:8-9`, mobile `apps/mobile/src/lib/stickers-storage.ts:15` and `apps/mobile/src/lib/stickers.ts:67`);
  - entry validation (web:29-69, mobile:161-204);
  - "remember" (web:77-78, mobile:251-259);
  - the `/api/stickers/…/file` URL rule (web:107-126, mobile:79-103).
- **The phone bug.** `apps/mobile/src/lib/stickers.ts:88-89` checks a relative path as a raw string, and `stickerImageSource` (`:121-131`) then adds the bearer token. Web parses through `URL`, which normalises `..` (web:113, 120).
- **File sizes:** `apps/web/src/lib/stickers.ts` is 136 lines and `apps/mobile/src/lib/stickers.ts` is 259.

### Steps
1. **The shared module.** Create `packages/chat-core/src/sticker-recents.ts` with `parseRecentStickers`, `addRecentSticker`, `removeRecentSticker` and `isStickerFileUrl(url, apiOrigin)`.
   - `isStickerFileUrl` always resolves with `new URL(url, apiOrigin)`.
   - It accepts only the same origin and a normalised path of `/api/stickers/<segments>/file`, with no `..` left after normalisation.
   - Add one export line at the end of `packages/chat-core/src/index.ts`.
2. **The apps use it.** `apps/web/src/lib/stickers.ts`, `apps/mobile/src/lib/stickers.ts` and `apps/mobile/src/lib/stickers-storage.ts` use the shared functions and drop their own copies. Exported names stay, so importers don't change.
3. **Tests** in a new `packages/chat-core/src/sticker-recents.test.ts`:
   - `/api/stickers/../auth/file` is refused;
   - a foreign host is refused;
   - a valid relative path and a valid absolute path are accepted;
   - recents are capped at 30, most recent first.
4. **Fewer lines.** Total non-test lines in these files must go down, with the before and after counts in the Report. Every file stays at or under 400 lines.

### Allowed files
- `packages/chat-core/src/sticker-recents.ts`
- `packages/chat-core/src/sticker-recents.test.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/stickers.ts`
- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/stickers-storage.ts`
- `work/T-2023-shared-sticker-recents.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/sticker-recents.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/sticker-recents.ts` (now 105 lines):** `RECENT_STICKERS_KEY`, `MAX_RECENT_STICKERS`, `parseRecentStickers`, `addRecentSticker` and `isStickerFileUrl`. Doc comments are one line each and the validation helpers are compact. The parser validates ids, URL, emoji and the optional mobile dimensions/mime, so hostile stored JSON reads as an empty list.
- **One-app helper removed from the shared module:** `removeRecentSticker` was only used by web, so `forgetRecentSticker` now filters the list locally. Mobile's `rememberRecentSticker` wrapper only renamed the shared function, so it is now `export { addRecentSticker as rememberRecentSticker, MAX_RECENT_STICKERS } from '@zilar/chat-core'`; no importer changed.
- **`apps/web/src/lib/stickers.ts`:** recents read/write and the URL check delegate to the shared functions; exported names are unchanged. The `localStorage` read/write still runs through the same `Effect` fallback, so a blocked or full store never breaks the panel or sending.
- **`apps/mobile/src/lib/stickers.ts`:** recents parsing, the add (re-exported under the old name) and the URL check use the shared module. The mobile entry type keeps its required `width`/`height`/`mime` with the existing square/png fallbacks.
- **`apps/mobile/src/lib/stickers-storage.ts`:** the recents key comes from `@zilar/chat-core` instead of a local copy.
- **Bug fix:** `/api/stickers/../auth/file` is resolved with `new URL` before the check, so `stickerImageSource` no longer attaches the bearer token to it.
- **Decode until stable:** `decodedPath` calls `safeDecode` at most 3 times, stopping when the path stops changing, so `%2e%2e` and `%252e%252e` are both refused. React Native's `URL` concatenates relative paths instead of normalising them, so this check is what protects the phone.
- **`packages/chat-core/src/sticker-recents.test.ts`:** 6 tests — literal `..`, `%2e%2e`, `%252e%252e`, a foreign host, valid relative and absolute paths, the 30-item newest-first cap, and hostile-entry parsing.
- Deleted `PREREVIEW.md`.

### Checks run

```text
pnpm --filter @zilar/chat-core exec vitest run src/sticker-recents.test.ts --reporter=dot
→ Test Files 1 passed (1); Tests 6 passed (6)
```

```text
pnpm gate
→ gate: 7 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/chat-core
PASS  tests @zilar/mobile
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

Line counts (non-test, the four product files):

| File | Before | After |
| --- | ---: | ---: |
| `apps/web/src/lib/stickers.ts` | 136 | 91 |
| `apps/mobile/src/lib/stickers.ts` | 259 | 157 |
| `apps/mobile/src/lib/stickers-storage.ts` | 60 | 61 |
| `packages/chat-core/src/sticker-recents.ts` (new) | 0 | 105 |
| **Total** | **455** | **414 (−41)** |

The shared module is 105 lines (limit 110) and the four-file total is 414 (limit below 440). `packages/chat-core/src/index.ts` (one added export line) and the test file are not counted.

Decisions:
- `packages/chat-core/src/sticker-recents.ts` starts with an `effect-plain:` marker, like `packages/chat-core/src/url.ts`: chat-core has no `effect` dependency, and this is a total parse where a failure is a value. The web file keeps its `Effect`-based fallback, so it stays an Effect file and passes the effect ratchet.
- Delivery is three commits: the shrink, the double-encoded dot-segment test, and this report plus the `PREREVIEW.md` deletion. No push, merge or branch switch.


## Review (written by Claude)

Approved after the lead's shrink round; the pre-review was clean, with 1 nit.
- **The security fix.** `isStickerFileUrl` resolves with `new URL` and decodes the path until it's stable, at most 3 times. It refuses `..`, `%2e%2e`, `%252e%252e` and foreign hosts. The phone adds its bearer token only after this check.
- **The phone runtime.** The lead read React Native 0.86.3's `URL`: two-argument resolution concatenates the path, and `origin`, `protocol` and `pathname` read correctly, so relative sticker paths keep their token.
- **Size.** Product lines went from 455 to 414, which is −41.
- **Waived deviation.** `removeRecentSticker` isn't shared, because only web's `forgetRecentSticker` needs it.
