---
id: T-2050
title: "Share W2-g (part 2): the phone's exact @handle lookup (PeopleSearchController, peopleHandleFor, the fixed messages) moves to client-core with a small hook; web's search uses it when the text starts with @ (Julio's Q4: '@handle like the phone') — one person row, or 'No one with that username.', instead of the prefix list"
status: merged
milestone: M5
branch: task/T-2050-web-handle-exact-lookup
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2050: Web `@handle` exact lookup, shared with the phone (share plan W2-g, part 2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, on share-plan question 4: on web, `@handle` becomes an exact handle lookup, **like the phone**.
- **Today on web:** the `@` is stripped, and the text runs the prefix search.
- **On the phone:** text starting with `@` runs the exact lookup (`GET /users/by-handle/:handle`), with a 900 ms debounce. Enter looks up at once. A missing user gets one muted line.

This task moves the phone's lookup logic to client-core, so both apps run the same code.

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **Phone controller.** `apps/mobile/src/components/contacts/people-search.ts` (214 lines):
  - `peopleHandleFor(text)` (`:41-47`): null unless the trimmed text starts with `@`; otherwise `addContactHandle(trimmed)`, which is `normalizeHandleInput` (`apps/mobile/src/lib/contacts-api.ts:102`: trim, strip `@`, lowercase), or null when empty;
  - `NO_PERSON_MESSAGE`, `PEOPLE_RATE_LIMITED_MESSAGE` and `PEOPLE_LOOKUP_ERROR_MESSAGE` (`:27-34`);
  - `PeopleSearchView` (`:49-55`);
  - `PeopleSearchController` (`:78-200`): the debounce with chat-core's `PEOPLE_SEARCH_DEBOUNCE_MS` (900); `lookupNow`; no repeat of the same handle; late answers dropped by request id; it uses `api.lookupByHandle(handle)` and `interruptFiber`;
  - `failureView` (`:202-214`): 404 → missing; 429 or `rate_limited` → `rateLimited`; else the error message. `ContactsApiError` is `ApiError` from `@zilar/api-contract` (`contacts-api.ts:94`).
  - There's no test file for it.
- **Phone hook.** `apps/mobile/src/components/contacts/use-people-search.ts` (71 lines): it wraps the controller with `useReducer`, `setApi`, `setText`, dispose, the Enter `submitRequest` and `openMessage`, which is phone-only (`resolveContactChat`). Its user is `people-search-result.tsx`, and `apps/mobile/src/app/(tabs)/index.tsx:128` uses `peopleHandleFor`.
- **Web.**
  - `apps/web/src/components/chatList/ChatListBody.tsx:61`: `showPeopleSearch = normalizePeopleQuery(search).length >= PEOPLE_SEARCH_MIN_LENGTH`.
  - `apps/web/src/components/PeopleSearchResult.tsx` (134 lines) shows People (prefix) and Public groups. Its `PersonRow({ entry: HandleProfile })` (`:76-111`) opens the DM for a contact, else `/@handle`.
  - `lookupByHandle(handle)` is at `apps/web/src/lib/api/people.ts:54`, exported through `@/lib/api`.
- **Shared code.** `packages/client-core` already depends on `@zilar/api-contract`, and its `src/use-delayed.ts` exports `interruptFiber` (T-2049). In the barrel `packages/client-core/src/index.ts`, line 1 is `export { makeFromApi, runApiAbortable } from './api-effect';`. Other tasks insert after lines 14 and 21, and at the end.

### Steps
1. **The shared module.** Create `packages/client-core/src/people-handle-search.ts`. Move into it:
   - `peopleHandleFor` (inline the normalise rule: trim, strip one `@`, lowercase);
   - the three messages, the view type (generic over the profile `P`), the controller and `failureView` (use `ApiError` from `@zilar/api-contract`).

   The controller takes `lookup: (handle: string) => Promise<P>` instead of the phone's `ContactsApi`.

   Add a hook `usePeopleHandleSearch<P>(lookup, text, submitRequest?): { view; target: P | null }` that wraps the controller exactly as the phone hook does today: `setText`, dispose, the Enter submit, and a ref to the latest `lookup`. Add ONE export line in the barrel, **directly after line 1**.
2. **Phone.**
   - `people-search.ts` becomes re-exports of the moved names, so importers don't change.
   - `use-people-search.ts` uses `usePeopleHandleSearch((h) => api.lookupByHandle(h), text, submitRequest)` and keeps only `openMessage` and `actionError`.
   - Behaviour stays exactly the same.
3. **Web.**
   - `ChatListBody.tsx:61` shows the section when `peopleHandleFor(search) !== null` or the normalised query is 3+ characters.
   - In `PeopleSearchResult.tsx`, when `peopleHandleFor(query) !== null`, the People part uses `usePeopleHandleSearch(lookupByHandle, query)`:
     - **looking:** "Looking up…";
     - **found:** one `PersonRow`;
     - **missing:** `NO_PERSON_MESSAGE`, muted;
     - **rate limited:** `PEOPLE_RATE_LIMITED_MESSAGE`, as an error StateMessage;
     - **error:** `PEOPLE_LOOKUP_ERROR_MESSAGE`.

     Otherwise the prefix search stays as today. Public groups stay as today in both cases. Keep the file at or under 400 lines.
4. **Tests.** Add `packages/client-core/src/people-handle-search.test.ts` for the pure part only. `peopleHandleFor`:
   - `'ana'` gives null;
   - `'@'` gives null;
   - `' @Ana '` gives `'ana'`.
5. **Size.** Report the line counts. The shared code replaces the phone's copy; web gains only its branch.

### Allowed files
- `packages/client-core/src/people-handle-search.ts`
- `packages/client-core/src/people-handle-search.test.ts`
- `packages/client-core/src/index.ts`
- `apps/mobile/src/components/contacts/people-search.ts`
- `apps/mobile/src/components/contacts/use-people-search.ts`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/web/src/components/PeopleSearchResult.tsx`
- `work/T-2050-web-handle-exact-lookup.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/people-handle-search.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead check, web mock:**
  - `@marta` shows one Marta row;
  - `@zzzz` shows "No one with that username.";
  - `mar` still shows the prefix list.

---

## Report (written by the worker when done)

### What I did

- **Shared module** `packages/client-core/src/people-handle-search.ts` (253 lines):
  moved `peopleHandleFor` (rule inlined: trim, strip one `@`, lowercase), the three
  fixed messages, `PEOPLE_SEARCH_DEBOUNCE_MS`, the generic `PeopleSearchView<P>`,
  `PeopleSearchController<P>` (now takes `lookup: (handle) => Promise<P>`), the
  scheduler seam (`PeopleSearchScheduler`) and `failureView` (uses `ApiError` from
  `@zilar/api-contract`). Added `usePeopleHandleSearch<P>` returning
  `{ view, target }`. Dropped the controller's phone-only `actionTarget`; the hook
  derives `target` from `view.status === 'found'`. One export statement added to the
  barrel directly after line 1.
- **Phone**: `people-search.ts` is now only re-exports (13 lines); `use-people-search.ts`
  (50 lines) uses `usePeopleHandleSearch<HandleProfile>((h) => api.lookupByHandle(h),
  text, submitRequest)` and keeps `openMessage`/`actionError`. No importer changed.
- **Web**: `ChatListBody.tsx:61` now shows the section for `peopleHandleFor(search) !==
  null` or 3+ normalised characters. `PeopleSearchResult.tsx` (185 lines) branches into
  `HandlePeople` (exact lookup: "Looking up…", one `PersonRow`, muted
  `NO_PERSON_MESSAGE`, rate-limited/error `StateMessage`s) and `PrefixPeople` (the old
  prefix list). Two subcomponents so the prefix hook is not called for `@` text (it
  would fire an extra, rate-limited `searchUsers` request). Public groups are unchanged.
- **Tests**: `people-handle-search.test.ts` covers the three `peopleHandleFor` cases
  from the spec.

Line counts: shared code 267 + test 16; phone 13 + 50 (was 214 + 71); web
`PeopleSearchResult` 185 (was 134), `ChatListBody` 210 (was 206). All changed
source files are under 400 lines (the `size` gate check passed).

### Checks run

- `pnpm install` — done (14.9s).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/people-handle-search.test.ts`
  — 1 test file passed, 3 tests passed.
- `pnpm gate` (first run) — FAIL on lint: `react(refs)` at
  `people-handle-search.ts:213` (ref read during render in the hook's `useState`
  initializer). Fixed by replacing the ref with a `setLookup` effect on the controller
  (the same pattern as the phone's old `setApi` effect); behaviour is identical.
- `pnpm exec prettier --write packages/client-core/src/people-handle-search.ts` — one
  file formatted (gate's format check had flagged it).
- `pnpm gate` (final) summary:
  ```
  PASS  install (frozen)  (4.2s)
  PASS  format  (1.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.8s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (1.4s)
  PASS  tests @zilar/client-core  (4.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation (small, behaviour-neutral):** the hook keeps the latest lookup via
  `controller.setLookup(lookup)` in an effect, not a ref. Reading `ref.current` inside
  the `useState` initializer (the only place that could hold it during render) is
  rejected by the repo's `react(refs)` lint rule. This mirrors the phone hook's old
  `setApi` effect.
- **Not tested in the browser:** the web mock checks (`@marta`, `@zzzz`, `mar`) were
  not run; they are the lead's acceptance step. The gate passed and the pure
  `peopleHandleFor` cases are covered.
- The section now mounts for a bare `@`? No: `peopleHandleFor('@')` is null and the
  normalised query is shorter than 3, so nothing shows.
- **Lead check fix (StrictMode):** web mounts under React StrictMode, whose
  simulated unmount disposed the controller for good, so `setText` stayed frozen and
  "Looking up…" never settled. Added `PeopleSearchController.resume()` (clears
  `disposed`, resets `lastRequested`, refreshes the current text) and the hook now runs
  `resume` on mount with `dispose` as its cleanup. The lead re-checks `@marta`,
  `@zzzz` and `mar` on the web mock.
- Public groups keep working for `@` queries, as before.


## Review (written by Claude)

Approved after one lead fix round; the pre-review was clean.
- **What changed.** The phone's exact `@handle` lookup (controller, `peopleHandleFor`, fixed messages) now lives in client-core with `usePeopleHandleSearch`. Web uses it for `@` text (Julio's Q4), and the phone re-exports it.
- **The fix round.** On the first lead check, the lookup hung on "Looking up…": React StrictMode's dev remount disposed the controller for good. The worker added `resume()` in the mount effect.
- **Lead Playwright check at `5cb50cd25`** (web mock, :5195):
  - `@marta` shows one Marta row;
  - `mar` still shows the prefix list (Marta, Marco);
  - no console errors.
  - The mock invents a profile for any handle, so the "No one with that username." line can only show against the real server (404).
- **Size.** +112 product lines: web gains a feature, and the shared module replaces the phone's 214-line copy.
