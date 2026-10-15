---
id: T-1502
title: "Telegram importer keeps video stickers (approved Stickers canvas): move storeImportedSticker out of the 399-line telegram.ts, then import is_video (.webm) stickers through the T-1496 converter; only Lottie (.tgs) is still skipped"
status: merged
milestone: M5
branch: task/T-1502-telegram-video-stickers
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1502: Telegram importer keeps video stickers

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15 (`docs/design/mockups/stickers/README.md`, "Rules the design set"): "The Telegram importer keeps video (`.webm`) stickers through the same conversion. Lottie (`.tgs`) comes later."

Today the importer skips every moving sticker. The server's converter (T-1496) already turns a WebM into an animated WebP.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/stickers/telegram.ts` is 399 lines**, at the 400-line limit, so code has to move out before any is added.
  - `:24-31` the header comment says animated/video stickers are skipped;
  - `:167-178` the candidate loop skips `entry.animated` (`:171`) and counts it in `skippedAnimated`;
  - `:206-218` downloads each file (a `file_too_large` download counts as skipped);
  - `:302-399` `storeImportedSticker` with its comment: it probes the bytes and returns `'skipped'` above 512 KiB (`:315`) or on a failed probe (`:318-320`), then inserts and writes the file.
- **`apps/server/src/stickers/telegram/set.ts`:**
  - `:9-10` `animated` is "True for animated (`.tgs`) and video (`.webm`) stickers: skipped";
  - `:35-43` `isAnimated` returns `is_animated === true || is_video === true`;
  - `:55` builds the entry.
- **The converter:**
  - `apps/server/src/stickers/storage.ts:222-225` is how uploads use it: `const kind = convertibleKind(bytes); if (kind !== null) { bytes = await (deps.converter ?? defaultConverter).toAnimatedWebp(bytes, kind); }`;
  - `convertibleKind` and `defaultConverter` come from `apps/server/src/stickers/convert.ts`;
  - `converter` is an optional field of `StickersServiceDeps` (`apps/server/src/stickers/schemas.ts:57-58`), and `TelegramImportDeps` extends it;
  - a failed conversion throws an `HttpError` (for example `sticker_too_long` at `apps/server/src/stickers/convert.ts:196-197`).
- **Download cap:** `TELEGRAM_IMPORT_MAX_BYTES` is 1 MiB (`apps/server/src/stickers/telegram/errors.ts:5`). Telegram video stickers are at most 256 KB.
- **The clients** show `skippedAnimated` as "N animated stickers were skipped" (`apps/web/src/components/TelegramImportDialog.tsx:155-156`, `apps/mobile/src/components/stickers/telegram-import.ts:55-58`). After this task it counts only Lottie stickers, which are still animated, so the text stays right.

### Steps (one commit each)
1. **Move only.** Move `storeImportedSticker` and its comment (`telegram.ts:302-399`) into a new file `apps/server/src/stickers/telegram-store.ts`. Export it, import it in `telegram.ts`, and move only the imports it needs. No behaviour change.
2. **`apps/server/src/stickers/telegram/set.ts`:**
   - the entry gets `video: boolean` (`is_video === true`);
   - `animated` becomes `is_animated === true` only (Lottie `.tgs`);
   - fix the comment at `:9-10`.
3. **`apps/server/src/stickers/telegram.ts`:** the loop still skips `entry.animated` (now Lottie only) and lets video entries through. Update the header comment (`:24-31`) to say video stickers are converted and only Lottie is skipped.
4. **`apps/server/src/stickers/telegram-store.ts`:**
   - before the 512 KiB check and the probe, run `convertibleKind(bytes)`;
   - when it is not `null`, convert with `(deps.converter ?? defaultConverter).toAnimatedWebp(bytes, kind)`;
   - any error from the conversion returns `'skipped'` (it counts in `skippedInvalid`, like a file that fails validation) and never fails the import;
   - the converted bytes then go through the same checks, insert and write as a still.

### Not in scope
- Lottie (`.tgs`);
- any client change;
- the import budget (`deadlineMs`): a pack that runs out of time is `partial`, and a re-run adds the rest, as today.

### Tests
None (stickers are not crucial code, CLAUDE.md Hard rules). The existing server tests must still pass.

### Allowed files
- `apps/server/src/stickers/telegram.ts`
- `apps/server/src/stickers/telegram-store.ts` (new)
- `apps/server/src/stickers/telegram/set.ts`
- `work/T-1502-telegram-video-stickers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Importing a Telegram video pack stores each sticker as an animated WebP.
- A Lottie pack still reports its stickers as skipped animated ones.
- `telegram.ts` ends well under 400 lines, and `telegram-store.ts` stays under 400.

---

## Report (written by the worker when done)

### What I did

Four commits, one per spec step:

1. Moved `storeImportedSticker` and its comment out of `apps/server/src/stickers/telegram.ts`
   into the new `apps/server/src/stickers/telegram-store.ts` (exported), imported it back in
   `telegram.ts`, and moved only the imports it needs. The store's `deps` parameter is typed
   `StickersServiceDeps` (it only reads `db`, `storageDir` and, after step 4, `converter`), so
   the moved module does not import `telegram.ts` and there is no cycle. No behaviour change.
   `telegram.ts` went from 399 to 300 lines.
2. `apps/server/src/stickers/telegram/set.ts`: the entry now has `video: boolean`
   (`is_video === true`); `animated` is `is_animated === true` only; the comment was fixed.
3. `apps/server/src/stickers/telegram.ts`: updated the header comment (video `.webm` is
   converted, only Lottie `.tgs` and invalid files are skipped) and added a one-line comment
   on the candidate loop. The loop itself is unchanged: it still skips `entry.animated`, which
   is now Lottie-only, so video entries fall through.
4. `apps/server/src/stickers/telegram-store.ts`: the empty check stays first; then
   `convertibleKind(bytes)` runs before the 512 KiB check and the probe, and when it is not
   `null` the bytes are converted with `(deps.converter ?? defaultConverter).toAnimatedWebp`.
   A conversion failure returns `'skipped'` (counts in `skippedInvalid`) and never fails the
   import; the converted bytes then follow the same probe/insert/write path as a still.

Files changed: `apps/server/src/stickers/telegram.ts`,
`apps/server/src/stickers/telegram-store.ts` (new),
`apps/server/src/stickers/telegram/set.ts`, `work/T-1502-telegram-video-stickers.md`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/pack-link.test.ts`
  → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (4.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- No tests were added: stickers are not crucial code (AGENTS.md / CLAUDE.md hard rules), and
  there was no existing telegram importer test to extend. The existing stickers test still
  passes. Behaviour of the conversion path is the same code the upload route already uses.
- No client, contract or budget changes. `skippedAnimated` now counts only Lottie, and the
  existing client copy ("N animated stickers were skipped") is still accurate.
- `TelegramStickerEntry.video` is parsed and set but not read yet; the spec (step 2) asks for
  it, and conversion is keyed off `convertibleKind(bytes)` as specified, so nothing consumes
  it today. Flagging in case you want it removed or used.
- `telegram.ts` is 300 lines and `telegram-store.ts` is 127 lines, both well under 400
  (confirmed by the gate's size check).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits, for head `9d78c504a`.
- **Nits, both left as they are:**
  - `video` is parsed but unused;
  - the conversion runs on any convertible bytes, not only `.webm`. That matches the upload path: the converter sniffs magic bytes and caps size and duration.
- **The lead read the diff:**
  - the move is faithful;
  - only Lottie is skipped now;
  - a failed conversion is a skip, never a failed import;
  - `telegram.ts` went from 399 to 300 lines.
- **Not tested live:** an import needs a signed-in user and a public video pack. The converter itself was checked live in T-1496.
