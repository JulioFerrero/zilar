---
id: T-2067
title: "Share (web + phone): one handle-save wording in chat-core (handle_invalid / reserved / taken / change_too_soon with the next-change date / rate_limited, 'username' or 'handle' as the noun) replaces five copies — web profile, web group visibility, web handle page, phone profile, phone visibility sheet — and the phone visibility sheet now shows the date like web"
status: merged
milestone: M5
branch: task/T-2067-shared-handle-errors
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2067: One handle-error wording

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. The same "why your username/handle didn't save" switch is written **five times**, and the copies have drifted:
- the phone visibility sheet says "That handle changed recently." where web shows the next-change date;
- web's `HandlePage` shows only the raw message.

One function in chat-core fixes both.

### Facts (read by the lead on 2026-10-18 at `10ac0deaf`)
- **The pattern.** `packages/chat-core/src/ai-errors.ts` (44 lines) maps AI failure codes to words through a structural `AiFailure { code; status; message }`. It's exported at `packages/chat-core/src/index.ts:47`.
- **The five copies.**
  1. `apps/web/src/components/ProfileSettingsSection.tsx:326-355`, `friendlyError(error: ApiFailure)`. Its words:
     - invalid: "Use 3–32 characters: letters, numbers and _, starting with a letter.";
     - reserved: "That username is reserved. Try another.";
     - taken: "That username was just taken. Try another.";
     - too soon: `Next change possible on <date>` from `error.detail.nextChangeAt`, else the message;
     - rate limited: "Too many tries — wait a little and try again.";
     - otherwise the message, with `unknown_error` mapped to "Could not save your changes. Try again.".
  2. `apps/web/src/components/VisibilitySection.tsx:255-284`: the same with the noun "handle", plus its own `StoreFailed` and `unknown_error` lines.
  3. `apps/web/src/routes/HandlePage.tsx:~185-203`: the same words, but too soon returns only `error.message`.
  4. `apps/mobile/src/components/settings/profile-logic.ts:72-99`, `friendlyClaimError`: the same words as copy 1. It reads `error.nextChangeAt` (`ProfileApiError`, `apps/mobile/src/lib/profile-api.ts:65-75`).
  5. `apps/mobile/src/components/chat/visibility-sheet.tsx:37-60`, `visibilitySaveError`: noun "handle"; too soon is "That handle changed recently. Try again later."; plus `not_found` and network lines.

### Steps
1. **The shared function.** Create `packages/chat-core/src/handle-errors.ts` with:

   ```ts
   handleSaveMessage(error: { code: string; message: string; nextChangeAt?: string | undefined }, noun: 'username' | 'handle'): string | undefined
   ```

   It returns the words for `handle_invalid`, `handle_reserved`, `handle_taken`, `handle_change_too_soon` (the date when `nextChangeAt` parses, else the message) and `rate_limited`, and `undefined` for any other code.

   Add ONE line `export * from './handle-errors';` to the chat-core barrel **directly after line 47** (`./ai-errors`), not at the end.
2. **The callers.** All five call it first, passing `nextChangeAt` from wherever their error carries it (web `error.detail.nextChangeAt` when it is a string; phone `error.nextChangeAt`). Each keeps its own fallbacks: web's `unknown_error` and `StoreFailed` lines, the phone's `not_found`, network and default lines. The visible change:
   - the phone visibility sheet and web `HandlePage` now show the next-change date, like web profile already does.
3. **Tests.** Add `packages/chat-core/src/handle-errors.test.ts` with a few cases: each code, a too-soon error with a valid and an invalid date, and an unknown code giving `undefined`. Handles are account identity, so this wording is worth pinning.
4. **Size.** Product lines must go down. Report the counts.

### Allowed files
- `packages/chat-core/src/handle-errors.ts`
- `packages/chat-core/src/handle-errors.test.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/VisibilitySection.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/mobile/src/components/settings/profile-logic.ts`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/lib/directory-api.ts` (added by the lead on 2026-10-18 for follow-up F1)
- `work/T-2067-shared-handle-errors.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/handle-errors.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did
- Added `packages/chat-core/src/handle-errors.ts` with `handleSaveMessage(error, noun)`: it maps `handle_invalid`, `handle_reserved`, `handle_taken`, `handle_change_too_soon` (the next-change date when `nextChangeAt` parses, else the message) and `rate_limited`, and returns `undefined` for any other code.
- Exported it from the chat-core barrel directly after `./ai-errors` (`packages/chat-core/src/index.ts:48`).
- Wired all five callers to the shared function, keeping their own fallbacks:
  - `apps/web/src/components/ProfileSettingsSection.tsx` (noun `username`, `error.detail.nextChangeAt`, keeps `unknown_error` and message fallback);
  - `apps/web/src/components/VisibilitySection.tsx` (noun `handle`, keeps `StoreFailed`, `unknown_error` and message fallback);
  - `apps/web/src/routes/HandlePage.tsx` (noun `username`, keeps `UsernameMissing` / `SaveFailed`; now shows the next-change date instead of only the raw message);
  - `apps/mobile/src/components/settings/profile-logic.ts` (noun `username`, uses `ProfileApiError.nextChangeAt`);
  - `apps/mobile/src/components/chat/visibility-sheet.tsx` (noun `handle`, now shows the next-change date; keeps `not_found`, network and default lines).
- Added `packages/chat-core/src/handle-errors.test.ts` with 6 cases: each shared code, a too-soon error with a valid and an invalid date, and an unknown code returning `undefined`.

Size (product lines, five caller files `before -> after`):
- `ProfileSettingsSection.tsx` 355 -> 343
- `VisibilitySection.tsx` 284 -> 274
- `HandlePage.tsx` 203 -> 202
- `profile-logic.ts` 188 -> 171
- `visibility-sheet.tsx` 251 -> 251
- Callers total 1281 -> 1241 (-40); shared helper 30 lines + barrel 1 line, so product code is net 9 lines down.

### Checks run
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/handle-errors.test.ts` — 1 file passed, 6 tests passed.
- `pnpm gate` (the first run failed only on Prettier in the new test file, fixed by hand; after that it passed):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/chat-core  (1.7s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The phone visibility sheet's `DirectoryApiError` is the api-contract `ApiError`, which carries `nextChangeAt` in `detail`, not at the top level (unlike `ProfileApiError`). That caller reads `error.detail.nextChangeAt`; the spec's "phone `error.nextChangeAt`" applies to the profile caller.
- F1 follow-up: `apps/mobile/src/lib/directory-api.ts` now passes the server's `nextChangeAt` through. `DirectoryRequestError` gained a `detail: Record<string, unknown>` field, `requestEffect` reads `body.error.nextChangeAt` safely and keeps it only when it is a string, and the Promise edge passes it as the 4th argument to `DirectoryApiError`, so the phone visibility sheet can show the next-change date.
- No deviations from the spec otherwise; no new dependencies.

## Review (written by Claude)

Approved after one lead fix round (follow-up F1).
- **What changed.** One `handleSaveMessage(error, noun)` in chat-core, with tests, replaces five copies across web profile, web visibility, `HandlePage`, phone profile and the phone visibility sheet.
- **Fix round.** The phone `directory-api.ts` now keeps the server's `nextChangeAt` (`body.error.nextChangeAt`, `edge-request.ts:101-109`) in `ApiError.detail`. The phone visibility sheet and `HandlePage` therefore show "Next change possible on <date>" like web profile. Before, the sheet showed a fixed sentence, and `HandlePage` showed the raw message.
- **Size.** Product lines −3, plus 50 test lines. Handles are account identity, so the wording is pinned by tests.
- **Pre-review.** Clean on `60261c1e2`.
