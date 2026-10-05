---
id: T-0207
title: Mobile: import a Telegram sticker pack from the Stickers screen
status: merged
milestone: M5
branch: task/T-0207-mobile-telegram-sticker-import
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0191]
estimate: 1 day
---

# T-0207: Mobile Telegram sticker import

## Spec (written by Claude, do not edit)

### Why
Julio's product direction: user stickers plus a Telegram importer. Web has `TelegramImportDialog`; the phone cannot import. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Split out of T-0191 (the pack editor), which this builds on.

### Design
Follow `docs/design/briefs/T-0207-telegram-import.md` exactly for layout, sizes, icons, copy, states and error sentences. Where this spec and the brief disagree, the spec wins.

### Verified facts (do not re-derive)
- Server route `POST /sticker-packs/import/telegram` (`apps/server/src/stickers/routes.ts` line 201), body exactly `{ input: string }` (1 to 512 characters, `.strict()`, line 134). Responses:
  - 200: `{ pack, imported, skippedAnimated, skippedInvalid, partial? }` (lines 230-236); `partial` is present only when true.
  - 501 `import_unavailable` (no Telegram token on the server, line 205).
  - 400 `invalid_request` (bad link or name, line 222, or a body problem).
  - 429 `rate_limited` (3 imports per hour per person, line 227).
  - From the service (`apps/server/src/stickers/service.ts`): 404 `pack_not_found`, 503 `try_later`, 409 `token_invalid`, 400 `custom_emoji_unsupported`, 400 `pack_limit`.
  - The import can take up to 30 seconds.
- Web client: `importTelegramStickers(input)` and `telegramImportResultSchema` in `apps/web/src/lib/api.ts` (lines 1616-1632). Web dialog: `apps/web/src/components/TelegramImportDialog.tsx`.
- After T-0191: the mobile `StickerPack` has optional `ownerId`, `visibility`, `importedFrom`; `StickersApi` in `apps/mobile/src/lib/stickers-api.ts` has the editor functions; the mock is `apps/mobile/src/components/stickers/stickers-mock.ts`; the editor route is `/settings/sticker-pack?id=...`; the Stickers screen `apps/mobile/src/app/settings/stickers.tsx` has the `New pack` pill in the My packs heading row. Read these files on main before you start; the line numbers moved with T-0191.
- Modals and sheets: copy the structure of the confirm `Modal` already in `stickers.tsx` (transparent, `bg-black/40` backdrop).

### What to build
1. `StickersApi` + real client + mock gain `importTelegramStickers(input: string): Promise<TelegramImportResult>` with `TelegramImportResult = { pack: StickerPack; imported: number; skippedAnimated: number; skippedInvalid: number; partial: boolean }` (`partial` false when absent). Validate the response at the boundary like the other functions; errors become the module's error class with `status` and `code`. The mock returns a success, and it can be switched to the `partial`, `import_unavailable`, `token_invalid` and `rate_limited` outcomes for tests.
2. New `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`: the sheet of the brief with its form, busy, result, not-set-up and token-rejected states. Map errors to the brief's sentences by HTTP status and code (`import_unavailable` and `token_invalid` switch to their states; `rate_limited` and any 429 give the rate-limit sentence; `invalid_request` gives the invalid-link sentence; anything else, including network errors, gives `The import failed. Try again.`). Never show server text. One request at a time (ref guard). The sheet cannot be closed while busy.
3. Put the pure parts (error-to-state mapping, count sentences with singular and plural) in `apps/mobile/src/components/stickers/telegram-import.ts` so they are tested without rendering.
4. `stickers.tsx`: the `Import from Telegram` row under the My packs heading row (brief section 1) opens the sheet; `Done` reloads the list; `Open pack` closes the sheet and pushes `/settings/sticker-pack?id=<pack id>`. Nothing else on that screen changes.
5. Tests (Vitest): the API function (path, method, body, result parsing with and without `partial`, error mapping); `telegram-import.ts` (every code to its state or sentence, plural forms); the sheet (success with counts, partial with `Import again`, not-set-up state, rate limit sentence, empty input sentence, busy blocks close).

### Read first
`AGENTS.md`, `docs/design/briefs/T-0207-telegram-import.md`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`.

### Allowed files
`apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers-api.test.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-mock.test.ts`, `apps/mobile/src/components/stickers/telegram-import.ts` (new), `apps/mobile/src/components/stickers/telegram-import.test.ts` (new), `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (new), `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` (new), `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `work/T-0207-mobile-telegram-sticker-import.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers telegram-import
pnpm gate
```
The lead checks the sheet on the Android emulator (`pnpm phone:smoke`) before merging.

### Acceptance
- A Telegram pack link or name imports a pack; the result shows the counts; `partial` offers `Import again`; `Open pack` opens the editor.
- Every error code shows the brief's state or fixed sentence, never server text.
- No emoji in app chrome, no new dependency, no server change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Choosing a visibility for imported packs, animated stickers, an import history, the pack editor itself (T-0191).

---

## Report (written by the worker when done)

### What I did
Built the mobile Telegram sticker import per the spec and brief T-0207:
- `apps/mobile/src/lib/stickers-api.ts`: added `TelegramImportResult` (`partial` false
  when absent), `parseTelegramImportResult` boundary validation, and
  `StickersApi.importTelegramStickers(input)` (`POST /api/sticker-packs/import/telegram`,
  body exactly `{ input }`; errors become `StickersApiError` with `status` + `code`).
- `apps/mobile/src/components/stickers/telegram-import.ts` (new): pure error-to-state
  mapping and singular/plural count sentences with the brief's exact fixed sentences.
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (new): bottom sheet
  with form, busy, result, not-set-up and token-rejected states; one request at a time
  (ref guard); cannot close while busy (backdrop, Android back, Close/Cancel all
  guarded); `Done` reloads + closes; `Open pack` reloads, pushes
  `/settings/sticker-pack?id=<pack id>`, closes; `Import again` re-runs with the same
  input on `partial`. Never shows server text.
- `apps/mobile/src/app/settings/stickers.tsx`: `Import from Telegram` outline row under
  the My packs heading row (visible in every My packs state incl. empty, disabled while
  busy); opens the sheet; sheet remounts per open via `key` so earlier input/result/
  error clear.
- Mock (`stickers-mock.ts`): `importTelegramStickers` returning success, switchable via
  `setStickersMockTelegramImport` to `partial`, `import_unavailable` (501),
  `token_invalid` (409), `rate_limited` (429); `resetStickersMock` restores success.
- Tests: API (path/method/body, with/without `partial`, malformed body, error mapping);
  `telegram-import.ts` (every code, plurals); sheet (form copy, empty-input, import call,
  success counts, singular forms, partial + `Import again`, not-set-up, rate-limit
  sentence, token-rejected markup, busy blocks close + single request, idle close,
  Done/Open-pack wiring); mock outcomes; screen entry-row placement.

### Files changed
`apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers-api.test.ts`,
`apps/mobile/src/components/stickers/stickers-mock.ts`,
`apps/mobile/src/components/stickers/stickers-mock.test.ts`,
`apps/mobile/src/components/stickers/telegram-import.ts` (new),
`apps/mobile/src/components/stickers/telegram-import.test.ts` (new),
`apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (new),
`apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` (new),
`apps/mobile/src/components/stickers/stickers-screen.test.tsx`,
`apps/mobile/src/app/settings/stickers.tsx`.

### Commands and real results
- `pnpm install`: ok (10.2s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/stickers-api.test.ts src/components/stickers/telegram-import.test.ts`: 2 files, 36 tests passed.
- Same with `src/components/stickers/stickers-mock.test.ts src/components/stickers/telegram-import-sheet.test.tsx`: 2 files, 24 tests passed.
- Same with `src/components/stickers/stickers-screen.test.tsx`: 16 tests passed.
- `pnpm exec prettier --write` on my 4 unformatted files (after gate flagged format).
- `pnpm gate` (final): PASS install, PASS format, PASS lint, PASS typecheck,
  PASS tests @zilar/mobile; `scope: every changed file is inside the Allowed files`;
  `GATE PASS`. (11 changed files against main.)

### Problems / deviations
- The brief asks for `role="status"` on the busy line, but React Native's
  `AccessibilityRole` type has no `status`, so typecheck fails. Used the repo's existing
  pattern `accessibilityLiveRegion="polite"` (as in `sticker-pack.tsx`, `skeleton.tsx`)
  on the busy `View` instead.
- The brief's "opening clears state" was first implemented as a reset effect, but
  `oxlint react(set-state-in-effect)` fails the gate. Implemented it as a per-open
  remount (`key={telegram-import-<nonce>}`) from `stickers.tsx` instead; same behavior.

### Open questions / security checklist
- No secrets, logging, or new routes touched; no new dependency; no server change.
  Client-side only: one POST with bearer auth, fixed user-facing sentences only.
- Security checklist reviewed: nothing in scope adds deletes/updates scoping, caps,
  permissions, audit entries, or new routes beyond the existing authenticated import
  endpoint (rate-limited server-side per the spec).

### Blocked / needs a decision
Nothing. Ready for the lead's emulator check (`pnpm phone:smoke`).

### Round 2 (fix round, PREREVIEW findings)
- Finding 1 (should-fix, silent failed `Import again` + stale title on special): fixed in
  `telegram-import-sheet.tsx` — the result view now renders the error line, and a
  special-kind retry failure clears `result` before setting `special` so title and body
  agree. Tests: new `surfaces a failed Import again as an error line on the result
  card` (rate-limit retry sets the sentence + result view renders it) and `clears the
  result card when Import again hits a special state` (retry `token_invalid` sets
  `result` null + `special` token-rejected); result/special setters are now observed
  in the `useState` mock.
- Finding 2 (nit, untrimmed input): fixed on the same line the finding-1 fix touches
  (`invoke(rawInput.trim())`); the existing import-call test now sends padded input
  (`'  t.me/addstickers/FunCats \n'`) and asserts the trimmed value.
- Finding 3 (nit, `run() → setSpecial` wiring untested): covered as a side effect of
  the finding-1 tests — the special-state retry test drives `run()`'s catch branch
  into `setSpecial` end to end.
- Single tests: `telegram-import-sheet.test.tsx` — 14 passed (12 existing + 2 new).
- `pnpm gate`: PASS install, PASS format, PASS lint, PASS typecheck, PASS tests
  @zilar/mobile; scope clean; `GATE PASS` (11 changed files).
- No disagreements. Status stays `review`.

## Review (written by Claude)

**Verdict:** Approved after one automatic round (free Muse, first mobile task on it). `StickersApi.importTelegramStickers` with result validation and the error mapping in `telegram-import.ts`; the sheet `telegram-import-sheet.tsx` with form, busy, result, not-set-up and token-rejected states; the `Import from Telegram` row on the Stickers screen. Emulator (galena, signed in, live server): `pnpm phone:smoke` PASS; the lead opened the sheet and compared it with the brief (title and close, the explanation with the link format, the field with its placeholder, the personal-use note with the info icon, Cancel and Import), and pressing Import with an empty field shows "Paste a pack link or name first." without a request. A real import was not run: it would create a pack on the live server for the test account and count against its 3 imports per hour. No nits left.
