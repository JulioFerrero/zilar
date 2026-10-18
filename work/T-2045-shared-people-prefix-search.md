---
id: T-2045
title: "Share W2-g (part 1): one people prefix-search hook in client-core (normalise, 3-char minimum, 300 ms debounce, only the latest query writes, 429 → rate_limited, keep the old list on error) with the constants in chat-core; web usePeopleSearch and phone usePeoplePrefixSearch become thin adapters with the same names — no behaviour change, net about −100 lines"
status: merged
milestone: M5
branch: task/T-2045-shared-people-prefix-search
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2045: Shared people prefix search (share plan W2-g, part 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.5 found the people prefix search copied between the apps (jscpd clones mobile:62-95 ↔ web:65-98 and mobile:76-89 ↔ web:153-165). The net saving is about 100 lines. Behaviour doesn't change here. Julio's "@handle runs the exact lookup on web" change is a later, separate task.

### Facts (read by the lead on 2026-10-18 at `15a37d398`)
- **Web.** `apps/web/src/lib/usePeopleSearch.ts` (179 lines):
  - constants `PEOPLE_SEARCH_MIN_LENGTH = 3` and `PEOPLE_SEARCH_DEBOUNCE_MS = 300` (`:7-8`), plus `USER_SEARCH_MAX_LENGTH = 64`;
  - `PeopleSearchState` (`:14-19`): idle, loading, results with `entries`, rate_limited, error;
  - `normalizePeopleQuery` (`:34-38`);
  - `usePeopleSearch(query)` returns `{ state, updateProfile }`;
  - `useGroupSearch` (`:134-179`) **stays in web**.
  - Importers: `apps/web/src/components/PeopleSearchResult.tsx:4,11`, and `apps/web/src/components/chatList/ChatListBody.tsx:13`, which imports `normalizePeopleQuery` and `PEOPLE_SEARCH_MIN_LENGTH`.
- **Phone.** `apps/mobile/src/components/contacts/use-people-prefix-search.ts` (109 lines) has the same constants (`:9-14`), state (`:16-21`), `normalizePeopleQuery` (`:33-37`) and hook logic. `usePeoplePrefixSearch(api, query)` returns the state. Its importer is `people-list-section.tsx:8,19`.
- **Chat-core.** `packages/chat-core/src/search.ts` (11 lines) already exports `PEOPLE_SEARCH_DEBOUNCE_MS = 900`, which is the exact `@handle` lookup's delay: **same name, different value** from web's local 300.
- **The client-core barrel.** `packages/client-core/src/index.ts`; lines 15-20 export `./foreground-hooks`. Other tasks append at the end.

### Steps
1. **Chat-core constants.** In `packages/chat-core/src/search.ts`, add `PEOPLE_PREFIX_DEBOUNCE_MS = 300`, `PEOPLE_SEARCH_MIN_LENGTH = 3`, `USER_SEARCH_MAX_LENGTH = 64` and `normalizePeopleQuery`. Keep the existing 900 ms constant and its name.
2. **The shared hook.** Create `packages/client-core/src/people-search.ts`:
   - `usePeoplePrefixSearch<P>(search: (q: string) => Promise<readonly P[]>, query: string): { state: PeopleSearchState<P>; setEntries: (update: (entries: P[]) => P[]) => void }`;
   - it keeps today's exact rules: idle under 3 characters, the 300 ms debounce, only the latest query writes, a 429 gives `rate_limited` (use client-core `toApiFailure` to read the status), any other failure gives `error`.

   Add ONE export line in `packages/client-core/src/index.ts` **directly after line 20**, not at the end.
3. **Web.** `apps/web/src/lib/usePeopleSearch.ts` becomes:
   - re-exports of `normalizePeopleQuery` and `PEOPLE_SEARCH_MIN_LENGTH`;
   - `usePeopleSearch(query)`, which calls the shared hook with `(q) => searchUsers(q).then((r) => r.entries)` and builds `updateProfile` on `setEntries`;
   - `useGroupSearch`, unchanged.

   Rename web's local `PEOPLE_SEARCH_DEBOUNCE_MS` export to the shared `PEOPLE_PREFIX_DEBOUNCE_MS` only if nothing imports it; check with `git grep`.
4. **Phone.** `use-people-prefix-search.ts` becomes `usePeoplePrefixSearch(api, query)`, which returns `.state` of the shared hook called with `(q) => api.searchUsers(q)`.
5. **Tests.** Add `packages/client-core/src/people-search.test.ts` only for the pure parts: `normalizePeopleQuery`, and a pure state-transition helper if you extract one. Not the React hook (UI).
6. **Fewer lines.** Product lines across the touched files must drop by at least 80. Report the counts.

### Allowed files
- `packages/chat-core/src/search.ts`
- `packages/client-core/src/people-search.ts`
- `packages/client-core/src/people-search.test.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/usePeopleSearch.ts`
- `apps/mobile/src/components/contacts/use-people-prefix-search.ts`
- `work/T-2045-shared-people-prefix-search.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/people-search.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and product lines are at least 80 lower.
- **Lead check, web mock:**
  - typing `ab` stays idle;
  - typing `ana` shows people after the delay.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/search.ts`**: added `PEOPLE_PREFIX_DEBOUNCE_MS = 300`, `PEOPLE_SEARCH_MIN_LENGTH = 3`, `USER_SEARCH_MAX_LENGTH = 64` and `normalizePeopleQuery`. The existing `PEOPLE_SEARCH_DEBOUNCE_MS = 900` is untouched.
- **`packages/client-core/src/people-search.ts`** (new): `usePeoplePrefixSearch(search, query)` with the current rules (idle under 3 characters, 300 ms debounce, only the latest query writes, 429 → `rate_limited`, anything else → `error`) and the `setEntries` updater. It imports the constants and normaliser from `@zilar/chat-core` and `toApiFailure` from `./errors`. The debounce/lookup runs as one Effect fiber that the cleanup interrupts. A small pure helper (`peopleFailureState`) maps a failure to the rate-limited/error state, so that rule is testable.
- **`packages/client-core/src/index.ts`**: one export line directly after the `foreground-hooks` block (line 21).
- **`apps/web/src/lib/usePeopleSearch.ts`**: now re-exports `normalizePeopleQuery` and `PEOPLE_SEARCH_MIN_LENGTH`, and `usePeopleSearch` is a thin adapter over the shared hook that builds `updateProfile` on `setEntries`. `useGroupSearch` is behaviourally unchanged; it now uses the shared `PEOPLE_PREFIX_DEBOUNCE_MS`. The old local `PEOPLE_SEARCH_DEBOUNCE_MS` export was removed after `git grep` showed no importer outside the file itself.
- **`apps/mobile/src/components/contacts/use-people-prefix-search.ts`**: thin adapter `usePeoplePrefixSearch(api, query)` returning the shared hook's `.state`; the `PeoplePrefixSearchState` type is kept.
- **`packages/client-core/src/people-search.test.ts`** (new): tests `normalizePeopleQuery` and `peopleFailureState` (429 → `rate_limited`, other failures → `error`). No React hook test (UI).

**Product line counts** (non-test, `wc -l`): before `chat-core 11 + web 179 + mobile 109 + client-core/index 42 = 341`; after `chat-core 27 + shared 76 + client-core/index 43 + web 97 + mobile 18 = 261`, i.e. **80 lines fewer**. The new test file is 35 lines and not counted.

### Checks run

- `pnpm install` — Done in 15.4s.
- `pnpm --filter @zilar/client-core exec vitest run src/people-search.test.ts --reporter=dot` — 1 file passed, 3 tests passed.
- `git grep -n "PEOPLE_SEARCH_DEBOUNCE_MS" -- apps packages` — only the chat-core 900 ms constant and mobile's exact `@handle` lookup use that name; nothing imported web's local 300 ms export.
- `pnpm gate` (final run):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.5s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/chat-core  (1.5s)
  PASS  tests @zilar/client-core  (1.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed only on formatting of the two adapters; I ran `pnpm exec prettier --write` on those two files, then the run above passed. Earlier runs also failed lint (`set-state-in-effect`, then `refs` during render) and the Effect ratchet; those were fixed in the hook (setState now runs inside the Effect and the latest-search ref is updated in an effect).

### Notes for the lead

- No behaviour change intended: under 3 characters the state goes idle on the next tick (the old 0 ms debounce), 3+ characters show the old state until the 300 ms debounce elapses, and a response for an older query is dropped by both the fiber interrupt and the `latestQuery` guard.
- The 429 test checks `status === 429 || code === 'rate_limited'`: status is what the task asks for, the code keeps the old behaviour for the existing error mapping.
- The shared hook uses `Effect.runFork`/`Fiber.interrupt` instead of the apps' `useAction` because `client-core` has no app atom runtime; the Effect ratchet also forbids a timer. The adapters stay synchronous and keep their current signatures.
- The task title says "keep the old list on error", but neither current hook kept entries on an error (both set `{ status: 'error' }`), and the spec body says "any other failure gives `error`". I kept today's behaviour; if keeping the previous entries on an error is wanted, that is a follow-up change.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `usePeoplePrefixSearch` in client-core, with `normalizePeopleQuery` and the prefix constants in chat-core. The web and phone hooks are thin adapters with the same names.
- **Size.** About −80 product lines.
- **Lead Playwright check** (web mock, branch on :5190):
  - "ma" stays idle;
  - "mar" shows People with Marta (@marta) and Marco (@marco);
  - no console errors.
- **Separate follow-up:** web message-search snippets show raw Markdown ("## Review summary … \*\*both\*\*"). That predates this task.
