---
id: T-2020
title: "Share W1-e: one composer-drafts store in client-core (caps, debounced persist per user, scope switch, async hydrate that keeps typed text, React hook); web and phone keep thin storage adapters — with tests"
status: merged
milestone: M5
branch: task/T-2020-shared-composer-drafts
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2020: Shared composer drafts (share plan W1-e)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. The share plan (`docs/audit/share-plan.md` §2.1 and slice **W1-e**) found two copies of the composer-draft store. The logic is the same; only the storage differs. The net saving is about 95 lines.

Drafts can leak across accounts, which is a privacy rule, so tests are required.

### Facts (from `docs/audit/share-plan.md` §2.1, checked by the lead on 2026-10-18 at `754a53c34`)
- **The two copies.** `apps/web/src/lib/composer-drafts.ts` (174 lines) and `apps/mobile/src/lib/composer-drafts.ts` (260 lines).
- **The same in both:**
  - caps of 200 drafts and 4,000 characters (web:12-13, mobile:17-18);
  - decoding keeps the last 200 and truncates (web:60-63, mobile:93-98);
  - a debounced persist that captures the user and a copy of the map (web:80-108, mobile:118-160);
  - `scopeToUser` (web:113-122, mobile:169-177);
  - `getDraft`, `setDraft` and `subscribe`;
  - the `useSyncExternalStore` hook (web:167-174, mobile:246-253).
- **Platform-specific storage:**
  - web: synchronous `localStorage`, one key per user (web:26-34, 51-75);
  - phone: one async JSON file through `expo-file-system/legacy` (mobile:33-57, 84-113);
  - the phone also merges text typed while the file loads (`loadScopedDrafts`, mobile:185-201).
- **Drift:**
  - the write delay is 300 ms on web (web:14) and 500 ms on the phone (mobile:19);
  - the phone keeps every past user's drafts with no cap (mobile:65, 134).

### Steps
1. **Shared store.** Create `packages/client-core/src/composer-drafts.ts`:
   - `createComposerDrafts(storage: DraftStorage, opts?: { writeDelayMs?: number })` returns `{ getDraft, setDraft, subscribe, scopeToUser, hydrate }`;
   - `useComposerDraft(drafts, userId, chatId?)` uses plain `react` only;
   - `interface DraftStorage { load(userId): Map<string,string> | Promise<Map<string,string>>; save(userId, drafts): void }`.

   It keeps both apps' rules, including the async hydrate that keeps text typed while loading. Add one export line at the end of `packages/client-core/src/index.ts`.
2. **Thin adapters.** `apps/web/src/lib/composer-drafts.ts` and `apps/mobile/src/lib/composer-drafts.ts` become thin adapters with the **same exported names**, so their importers don't change:
   - web passes a `localStorage` storage and `writeDelayMs: 300`;
   - the phone passes the file storage and `writeDelayMs: 500`.

   Keep the phone's file format, so existing drafts survive the update.
3. **Tests** in a new `packages/client-core/src/composer-drafts.test.ts`:
   - switching the user never shows or writes the old user's drafts;
   - an async hydrate keeps text typed before it finished;
   - the caps hold;
   - the persist is debounced.
4. **Keep every file at or under 400 lines.**

### Allowed files
- `packages/client-core/src/composer-drafts.ts`
- `packages/client-core/src/composer-drafts.test.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/composer-drafts.ts`
- `apps/mobile/src/lib/composer-drafts.ts`
- `work/T-2020-shared-composer-drafts.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/composer-drafts.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- In the web mock and a phone mock build, the lead types a draft, switches chats and reloads (or cold-starts): the draft comes back.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/composer-drafts.ts` (267 lines):
  - `createComposerDrafts(storage, opts?)` returns `{ getDraft, setDraft, subscribe, scopeToUser, hydrate }`.
  - Caps 200 drafts and 4,000 characters both when writing and when merging loaded data.
  - Debounced persist captures the user and a copy of the map; a user switch flushes the leaving user's pending write to their own key.
  - Synchronous storage (web) loads during `scopeToUser`, so the first paint already shows the stored draft. Asynchronous storage (phone) merges in `hydrate` and keeps text typed while the load was in flight; typed text wins.
  - A user who leaves before their async load resolves has their typed text merged with the stored drafts and saved under their own key.
  - `useComposerDraft(drafts, userId, chatId?)` imports only `react` (`useSyncExternalStore` + `useEffect`).
- Exported the factory, hook and types at the end of `packages/client-core/src/index.ts`.
- Rewrote `apps/web/src/lib/composer-drafts.ts` (58 lines) as a thin adapter: synchronous `localStorage`, one key per user, `writeDelayMs: 300`, same exported names (`getDraft`, `setDraft`, `subscribe`, `useComposerDraft`). The hook wrapper reads `currentUserId` from `useChatSelector`.
- Rewrote `apps/mobile/src/lib/composer-drafts.ts` (143 lines) as a thin adapter: same `userId -> { chatId: text }` file format through `expo-file-system/legacy`, `writeDelayMs: 500`, same exported names including `scopeToUser` and `loadScopedDrafts`. Writes wait for the file's first read, so saving one user never drops the others, and the stored accounts are capped at the 5 most recent (fixes the "every past user, no cap" drift).
- Added `packages/client-core/src/composer-drafts.test.ts` (191 lines, 6 tests): account switch shows/writes nothing of the old user; async hydrate keeps typed text; a user leaving before the load resolves writes to their own key; 200-draft and 4,000-character caps on write and on load; debounced persist writes once with the latest text.

### Checks run

- `pnpm install` — done (pre-existing peer warning in `apps/mobile` for `@types/react` 19.3 vs 19.2; no errors).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/composer-drafts.test.ts` — `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm gate` — summary:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.5s)
PASS  lint  (1.0s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
PASS  tests @zilar/client-core  (1.2s)
PASS  tests @zilar/mobile  (2.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- The earlier gate run failed only on `effect` for the new shared file; fixed with the repo's documented `// effect-plain:` marker (reason: React external store; Promise/setTimeout are the debounce and async storage edges, not app logic), then the gate passed as above.

### Round (fix round 1)

- Fixed finding 1 (should-fix): `apps/mobile/src/lib/composer-drafts.ts` now decodes every stored account through the new shared `capStoredDrafts` export, restoring the per-user empty filter, last-200 slice and 4,000-character truncation the old phone code applied to all users. Dormant oversized entries can no longer be written back verbatim.
- Test added: `packages/client-core/src/composer-drafts.test.ts` — "caps every stored account, including users that are not loading". That file now has 7 tests, all passing.
- Findings 2 and 3 are nits and were left unchanged, as instructed.
- Commands: `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/composer-drafts.test.ts` — `Test Files 1 passed (1)`, `Tests 7 passed (7)`; `pnpm gate` — `GATE PASS` (install, format, lint, typecheck, effect, tests @zilar/client-core, tests @zilar/mobile, scope, migration, images, size).

### Round (fix round 2, shrink)

- Product lines: shared `composer-drafts.ts` 281 → **180**, web adapter 58 → **39**, mobile adapter 140 → **85**. Total **479 → 304** (−175); against the pre-share baseline of 434 that is **−130**.
- Shared module: one `DraftMap` alias; `capDrafts` reused for writes, loads and merges; one `mergeLoaded` used by both the scoped load and the leaving-user save; one persist path; single-use helpers removed and comments reduced.
- Delete-while-loading: a `setDraft(chatId, '')` made while the async load is in flight records the chat in `cleared`, and `mergeLoaded` drops those ids, so the stored draft cannot come back. Clearing a chat with no in-memory draft is tracked too.
- Test added: "keeps a draft cleared while an async hydrate finishes empty". The file now has 8 tests, all passing.
- Adapters keep the same exported names, the 300 ms web / 500 ms phone delays, the phone's `userId -> { chatId: text }` file format and `MAX_STORED_USERS` (5).
- Commands: `pnpm --filter @zilar/client-core exec vitest run src/composer-drafts.test.ts --reporter=dot` — `Test Files 1 passed (1)`, `Tests 8 passed (8)`; `pnpm gate` — `GATE PASS` (install, format, lint, typecheck, effect, tests @zilar/client-core, tests @zilar/mobile, scope, migration, images, size).
- Deleted `PREREVIEW.md` as instructed.

### Round (fix round 3, PREREVIEW)

- Fixed finding 1 (should-fix): clearing a draft that is only on disk while the async load is still in flight now schedules a write. The no-op-delete path in `setDraft` only returns early once the user is hydrated; before that, `dirty` is set, and when the load resolves the merged map without the cleared chat is persisted. This also covers leaving the user before their load resolves.
- Test added: `packages/client-core/src/composer-drafts.test.ts` — "persists a stored-only draft cleared while an async hydrate finishes". Verified it fails without the fix (`expected "vi.fn()" to be called… Number of calls: 0`) and passes with it. The file now has 9 tests.
- Finding 2 is a nit and was left unchanged, as instructed.
- Commands: `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/composer-drafts.test.ts` — `Test Files 1 passed (1)`, `Tests 9 passed (9)`; `pnpm gate` — `GATE PASS` (install, format, lint, typecheck, effect, tests @zilar/client-core, tests @zilar/mobile, scope, migration, images, size).

### Notes for the lead

- **Net line count does not match the ~95 saving in the share plan.** Product code is now 468 lines (`client-core` 267 + web 58 + mobile 143) against 434 before (+34). The shared store carries the defensive async paths (typed text while loading, leaving before load resolves) and its comments; the phone adapter still holds the file format, multi-user cache, queue and account cap. Happy to trim comments or drop the leaving-before-load path if you prefer a smaller diff.
- **Stored-account cap:** I chose 5 recent accounts (`MAX_STORED_USERS`). There was no number in the spec; tell me if you want a different one.
- I did not run the web mock or phone mock manual check in the acceptance section; that is the lead's smoke step.
- No new dependencies, no changes outside the Allowed files.

## Review (written by Claude)

Approved after the lead's shrink round and 2 auto rounds; the pre-review was clean with 2 nits.
- **Size.** Product lines went from 434 to 304: shared 180, web adapter 39, mobile adapter 85. That's −130.
- **The bug fix.** A draft cleared while the async load is in flight now stays cleared, and there's a test for it.
- **Leak test.** Switching the account never leaks a draft.
- **Behaviour per app.** Web writes after 300 ms and the phone after 500 ms, as before. The phone keeps its file format, and drafts are kept for at most 5 users.
