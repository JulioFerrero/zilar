---
id: T-1701
title: "Size split of apps/server/src/contact-requests/service.ts (385 lines): move the decisions (acceptContactRequest, decideContactRequest, declineContactRequest, cancelContactRequest) into a new contact-requests/decide.ts and re-export the three public ones from service.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1701-split-contact-requests
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1701: Split the request decisions out of contact-requests/service.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/contact-requests/service.ts` is 385 of 400 lines. Its header already says the module keeps "the mutating service functions"; the four decision functions are a self-contained second half.

### Facts (the lead read them on 2026-10-16)
- **`service.ts`:**
  - header comment `:1-12` (T-0983 split note);
  - imports `:14-32`:
    - `randomUUID`, `Effect`, `SqlClient`;
    - `addContactPair` and `syncRoster` from `../contacts/service`;
    - `runSql` and `HttpError`;
    - `isPendingPairViolation` and `notFound` from `./errors`;
    - from `./queries`: `auditFor`, `findActionableEffect`, `isContactEffect`, `MAX_PENDING_OUTGOING`, `pendingBetweenEffect`, `RE_REQUEST_COOLDOWN_DAYS`, `resolveHandleUser`, `serviceNow`, and the `ContactRequestRow` and `ContactRequestsDeps` types;
  - re-exports `:34-44`;
  - `createContactRequest :62-240`;
  - **the block to move:** from the comment `// Accepts a request (recipient only). …` (`:242`) to the end of the file:
    - `export async function acceptContactRequest :250`;
    - `async function decideContactRequest :330` (private);
    - `export async function declineContactRequest :369`;
    - `export async function cancelContactRequest :379-385`.
- **Importers** of the three exported functions, all from `./service`:
  - `apps/server/src/contact-requests/api.ts:35-38`;
  - `apps/server/src/contact-requests/contact-requests.test.ts:9-12`.
- **The folder `apps/server/src/contact-requests/`** holds `api.ts`, `contact-requests.test.ts`, `errors.ts`, `queries.ts`, `reads.ts`, `search.ts` and `service.ts`; there's no `decide.ts`.

### Steps
1. **Create `apps/server/src/contact-requests/decide.ts`** with the block moved **word for word**, comments included. Keep `decideContactRequest` private, plus the imports the block needs. It must not import from `./service`.
2. **`service.ts`:**
   - delete the block;
   - add `export { acceptContactRequest, cancelContactRequest, declineContactRequest } from './decide';` next to the other re-exports, so `api.ts` and the test keep working unchanged;
   - drop the imports it no longer uses;
   - add `./decide` (the accept, decline and cancel decisions) to the header's T-0983 note.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/contact-requests/decide.ts`
- `apps/server/src/contact-requests/service.ts`
- `work/T-1701-split-contact-requests.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/contact-requests --reporter=dot
pnpm gate
```

### Acceptance
- **`service.ts` is about 250 lines,** and `decide.ts` holds the four functions unchanged.
- **`src/contact-requests` tests and the server typecheck pass.**

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/contact-requests/decide.ts` and moved the decision block
  (`acceptContactRequest`, the private `decideContactRequest`, `declineContactRequest`,
  `cancelContactRequest`) into it word for word, comments included. Its imports are the
  ones the block needs: `Effect`, `SqlClient`, `addContactPair`/`syncRoster`, `runSql`,
  `notFound`, and from `./queries` `auditFor`, `findActionableEffect`, `serviceNow`,
  `ContactRequestRow`, `ContactRequestsDeps`. It does not import from `./service`. The
  file carries a short T-0983 split header note, matching `./reads` and `./queries`.
- `service.ts`: deleted the block, added
  `export { acceptContactRequest, cancelContactRequest, declineContactRequest } from './decide';`
  next to the other re-exports, dropped the now-unused imports (`addContactPair`,
  `syncRoster`, `notFound`, `findActionableEffect`), and extended the header's T-0983 note
  to mention `./decide`.
- No behaviour change and no new tests (`api.ts` and the test import the same public
  names from `./service` and keep working unchanged).

### Files changed
- `apps/server/src/contact-requests/decide.ts` (new, 159 lines)
- `apps/server/src/contact-requests/service.ts` (385 → 240 lines)
- `work/T-1701-split-contact-requests.md` (this report + status)

### Checks run
- `pnpm install` → done, 1137 packages (pre-existing peer warning on `apps/mobile`, unrelated).
- `pnpm --filter @zilar/server exec vitest run src/contact-requests --reporter=dot --maxWorkers=2`
  → Test Files 1 passed (1), Tests 10 passed (10).
- `pnpm gate` (repo root) → ended `GATE PASS`; summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (2.5s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (5.1s)`
  - `PASS  effect  (1.2s)`
  - `PASS  tests @zilar/server  (7.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead
- Acceptance met: `service.ts` is 240 lines (about 250) and `decide.ts` holds the four
  functions unchanged; `src/contact-requests` tests and the server typecheck pass.
- `decide.ts` got a short header note in the style of `./reads`/`./queries` ("moved
  unchanged from `./service`") since the spec did not state a header for the new file.
- Pure move: no logic was edited. No behaviour change and no new tests, as specified.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `decide.ts` apart from its header and two type names in the import list.
- **The re-export:** it keeps `api.ts` and the test unchanged.
- **The tests:** the lead ran `src/contact-requests` in the worktree: 1 file, 10 tests passed.
- **Result:** `contact-requests/service.ts` drops from 385 to 240 lines.
