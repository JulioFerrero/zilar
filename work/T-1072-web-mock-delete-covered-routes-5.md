---
id: T-1072
title: "Mock sweep W10 (web): delete the mock/api.ts me, me/handle, users/by-handle, contact-requests, blocks and handles/check routes the shared backend now answers"
status: merged
milestone: M5
branch: task/T-1072-web-mock-delete-covered-routes-5
model: auto
effort: default
depends_on: [T-1071, T-1067]
estimate: 0.25 day
---

# T-1072: Web mock sweep, part 5

## Spec (written by Claude, do not edit)

### Why
T-1067 added `contact-requests` (with `GET /users/by-handle/:handle`), `blocks`, `handles` (`GET /handles/check`) and `PUT /me/handle` to `@zilar/mock-backend`. The backend already served `GET`/`PATCH /me`.

T-1071 kept the matching `apps/web/src/mock/api.ts` branches for this slice. The file is 1,427 lines on main (2026-10-11). Web mock mode asks the backend first (`apps/web/src/mock/backend.ts`), so these branches can no longer run.

### What to build
1. **Probe first,** as in T-1071, with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path the following branches handle, using T-1067's seed handles (`taken_user`, a free handle such as `ada_fresh`, `admin`):
   - `me` (`GET`/`PATCH /me`, `PUT /me/handle`);
   - `users/by-handle`;
   - contact-requests (create, list, accept, decline, cancel);
   - blocks (`PUT`, `DELETE`, `GET`);
   - `handles/check`, including `kind=group`.

   Delete only the branches where every call gets a `Response`.
2. **Delete those branches,** and the helpers only they used (`grep` first). These include `mockContactRequestList`, `mockBlockList` and `mockCheckHandle`, if nothing else uses them.
3. **Keep** the push and voice branches (no backend route yet) and the state and seed machinery: `MockState`, `seedState`, `resetMockApi`, `setMockDelay`, `mockRequest`, and every seed function the seed still calls.
4. **Size:** at most about 800 changed lines.
5. **No other file changes.** If deleting a helper breaks an import in another web file, keep the helper and say so in the Report.

The lead runs a web check with `?mock=1`:
- Profile: claim a username, then try a taken one;
- open a profile by handle and send a contact request;
- block and unblock someone.

### Read first
`AGENTS.md`, `work/T-1067-mock-backend-contacts-blocks-handles.md` and `work/T-1071-web-mock-delete-covered-routes-4.md` (their Reports), `apps/web/src/mock/backend.ts`, and `apps/web/src/mock/api.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1072-web-mock-delete-covered-routes-5.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status, and every branch kept with the reason.

---

## Report (written by the worker when done)

### What I did

Probed `@zilar/mock-backend` first (throwaway vitest file, run then deleted; not
committed), then deleted from `apps/web/src/mock/api.ts` every `mockRequest`
branch whose every method and path the shared backend answers, plus every helper
that only those branches used (`grep`-checked).

Deleted branch families:

- `me`: `GET /me`, `PATCH /me`, `PUT /me/handle` (and the block's fallback);
- `users/by-handle`: `GET /users/by-handle/:handle`;
- `contact-requests`: `POST /contact-requests` (create), `GET /contact-requests`
  (list), `POST /contact-requests/:id/accept`, `POST /contact-requests/:id/decline`,
  `DELETE /contact-requests/:id` (cancel);
- `blocks`: `PUT /blocks/:userId`, `DELETE /blocks/:userId`, `GET /blocks`;
- `handles/check`: `GET /handles/check` (including `kind=group`).

Deleted helpers that became unused once those branches went (grep-confirmed as
used only from the deleted branches and each other): `mockHandleUserId`,
`mockHandleProfile`, `mockContactRequestRow`, `mockContactPerson`,
`mockPersonHandle`, `mockHandleProfileForId`, `mockContactRequestList`,
`mockContactRequestView`, `createMockContactRequest`, `decideMockContactRequest`,
`mockBlockList` and `mockCheckHandle`; and the now-unused imports
`RESERVED_HANDLES` (from `@/lib/handles`) and `PEOPLE` (from `./ids`).

I did **not** touch the push or voice branches (no backend route yet), or the
state and seed machinery (`MockState`/`seedState`/`resetMockApi`/`setMockDelay`/
`mockRequest`). The seeded `contactRequests`, `nextContactRequestSequence` and
`blockedUsers` state fields stay, because `seedState` populates them (same choice
as T-1071 kept for its seeded fields).

### Files changed

- `apps/web/src/mock/api.ts` (deletions plus the helper removals)
- `work/T-1072-web-mock-delete-covered-routes-5.md` (this report + status)

### Probe (spec item 1)

Throwaway vitest file `packages/mock-backend/src/__t1072-probe.test.ts` (created,
run, then deleted; not committed) called `createMockBackend({ delayMs: 0 }).http(
path, init)` with a fresh backend per line and T-1067's seed handles
(`taken_user`, `ada_fresh`, `admin`). Run:
`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1072-probe.test.ts`
→ `Test Files 1 passed (1)`, `Tests 1 passed (1)`. Every one of the 17 lines
returned a `Response`; none returned `undefined`.

```
GET    /me                                        backend=200
PATCH  /me                                        backend=200
PUT    /me/handle                                 backend=200
GET    /users/by-handle/taken_user                backend=200
GET    /users/by-handle/ada_fresh                 backend=200
POST   /contact-requests                          backend=201
GET    /contact-requests                          backend=200
POST   /contact-requests/cr-1/accept              backend=404
POST   /contact-requests/cr-1/decline             backend=404
DELETE /contact-requests/cr-1                     backend=404
PUT    /blocks/u-ana                              backend=200
DELETE /blocks/u-ana                              backend=200
GET    /blocks                                    backend=200
GET    /handles/check?handle=taken_user           backend=200
GET    /handles/check?handle=admin                backend=200
GET    /handles/check?handle=ada_fresh            backend=200
GET    /handles/check?handle=acme&kind=group      backend=200
```

The `404` lines are the backend's own domain answers (unknown / already-decided
request id), not `undefined`: the backend has a matching route for every method
and path, so those branches are dead in web mock mode (`apps/web/src/mock/
backend.ts` `dispatch` asks the backend first).

### Branches kept, and why

- push (config/subscriptions/settings/test) and voice (transcription/transcript) —
  no backend route; not covered (spec item 3).
- `MockState`/`seedState`/`resetMockApi`/`setMockDelay`/`mockRequest`, the seeded
  `contactRequests`/`blockedUsers` fields and the `MockContactRequest`/
  `MockBlockedUser` types — the state and seed machinery (spec item 3).

No helper was kept because of an import in another web file: `grep` over
`apps`/`packages` found only comments (in `packages/mock-backend/src/domains/**`)
naming the deleted helpers, no code imports.

### Size

`git diff --numstat` for `apps/web/src/mock/api.ts`: **1 insertion, 374 deletions
(375 changed lines)**, well inside the ~800 budget. (The single insertion is the
`import { currentUserId } from './ids';` line; the rest are deletions.)

### Commands and real results

- `pnpm install` → done, no errors.
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1072-probe.test.ts`
  → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- No single test file covers `apps/web/src/mock/api.ts` (the folder's only test,
  `apps/web/src/mock/gate.test.ts`, does not import `api.ts`), so the nearest
  tests are the `@zilar/web` suite `pnpm gate` runs.
- `pnpm gate` → **GATE PASS**; summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/web  (2.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

- No functional behaviour change is expected: the shared backend answers every
  deleted route (probe above) and the web dispatcher already tries it first.
- The `T-0163` comment block on the kept `contactRequests` state field still
  describes the deleted handle-resolution behaviour. I left it because the field
  and its seed comment are part of the state machinery the spec asks to keep.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **The change:** 374 lines deleted from `apps/web/src/mock/api.ts`: the `me`, `me/handle`, `users/by-handle`, contact-requests, blocks and `handles/check` branches, with their helpers.
- **Why the deletions are safe:** the worker's probe got a backend `Response` for each deleted route.
- **Kept:** push, voice and the state machinery.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - **`/u/some_guy`** finds Some guy, and Add contact answers "Request sent.";
  - **Block** opens its confirmation, and I confirmed it. I did not read the blocked list back afterwards;
  - **Settings › Profile:** `taken_user` shows "That username is taken. Try another.", and `ada_fresh` shows "@ada_fresh is available", then "Saved." on save.
- **Check:** the gate passed, including the `@zilar/web` tests.
