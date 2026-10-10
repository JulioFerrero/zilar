---
id: T-1067
title: "Mock backend F3: contact-requests (with users/by-handle), blocks, handles/check and PUT /me/handle domains in @zilar/mock-backend"
status: merged
milestone: M5
branch: task/T-1067-mock-backend-contacts-blocks-handles
model: auto
effort: default
depends_on: [T-1059]
estimate: 0.5 day
---

# T-1067: Contacts, blocks and handles in the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §1b. The shared backend has no routes for these contract groups:
- `packages/api-contract/src/contact-requests.ts:106-127` (create, list, accept, decline, cancel, and `GET /users/by-handle/:handle`);
- `packages/api-contract/src/blocks.ts:28-36` (block, unblock, list);
- `packages/api-contract/src/handles.ts:53` (`GET /handles/check`);
- `PUT /me/handle`. The `me` domain, `packages/mock-backend/src/domains/me/routes.ts`, serves only `GET`/`PATCH /me`.

**What the gap blocks:**
- mobile contacts, profile and directory, which stay on their old mocks (T-1064 found that the backend lacks `handles/check`);
- web sweep W10: web still serves these routes from `apps/web/src/mock/api.ts`. The anchors are on main, 2026-10-11:
  - `me` handle: `:1627` onwards;
  - users and contact-requests: `:1663-1710`;
  - blocks: `:1711-1738`;
  - handles: `:1739`;
  - the helpers `mockContactRequestList` (`:1198`), `mockBlockList` (`:1287`) and `mockCheckHandle` (`:1313`).

### What to build
1. **New domains** under `packages/mock-backend/src/domains/`: `contact-requests` (it includes `users/by-handle`), `blocks` and `handles`. Use the same module shape as `chat-prefs`/`pins` (T-1044): `tables.ts` module augmentation, seed, state, routes and index, plus one alphabetical line each in `domains/index.ts`.
   - Mirror web's mock behaviour and seed data from the anchors above, keyed by the unified seed's people (`packages/mock-backend/src/domains/contacts/`, the `me` domain).
2. **`PUT /me/handle`:** add it to the `me` domain, with the same availability rule as `mockCheckHandle`. A taken handle answers 409, like web's mock.
3. **Response shapes:** every response decodes with the contract schema.
4. **Scope:** no app files change, and no tests. Prove it in the Report with a throwaway script against `createMockBackend()`, decoding each response with its contract schema.
5. **Size:** every file is under 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` §2, `packages/mock-backend/src/domains/pins/` (the shape), `packages/mock-backend/src/domains/me/`, the three contract files above, and `apps/web/src/mock/api.ts` at the anchors.

### Allowed files
`packages/mock-backend/src/domains/contact-requests/index.ts`, `packages/mock-backend/src/domains/contact-requests/routes.ts`, `packages/mock-backend/src/domains/contact-requests/seed.ts`, `packages/mock-backend/src/domains/contact-requests/state.ts`, `packages/mock-backend/src/domains/contact-requests/tables.ts`, `packages/mock-backend/src/domains/blocks/index.ts`, `packages/mock-backend/src/domains/blocks/routes.ts`, `packages/mock-backend/src/domains/blocks/seed.ts`, `packages/mock-backend/src/domains/blocks/state.ts`, `packages/mock-backend/src/domains/blocks/tables.ts`, `packages/mock-backend/src/domains/handles/index.ts`, `packages/mock-backend/src/domains/handles/routes.ts`, `packages/mock-backend/src/domains/handles/check.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `packages/mock-backend/src/domains/index.ts`, `work/T-1067-mock-backend-contacts-blocks-handles.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the decoded proof for each new route.

---

## Report (written by the worker when done)

### What I did

Added three mock-backend domains and the missing `me` route, mirroring web's
mock (`apps/web/src/mock/api.ts`) and keyed to the unified seed's people
(`packages/mock-backend/src/data/people.ts`, the `me` domain):

- **`contact-requests`** (`tables.ts`, `seed.ts`, `state.ts`, `routes.ts`,
  `index.ts`): `POST`/`GET /contact-requests`, `POST /contact-requests/:id/accept`,
  `POST /contact-requests/:id/decline`, `DELETE /contact-requests/:id` and
  `GET /users/by-handle/:handle`. Seed is empty like web's (`contactRequests: []`).
  Create answers `200 { request, incoming: true }` when the other side already
  asked, `201 { request }` otherwise; a decision sets `decidedAt`.
- **`blocks`** (`tables.ts`, `seed.ts`, `state.ts`, `routes.ts`, `index.ts`):
  `PUT`/`DELETE /blocks/:userId` and `GET /blocks` (newest first). Seed empty like
  web's (`blockedUsers: []`). Blocking is silent and idempotent; an unknown id
  404s, unblocking an unknown id still succeeds.
- **`handles`** (`check.ts`, `routes.ts`, `index.ts`): `GET /handles/check`
  (including `kind=group` reporting `acme` as taken). Stateless, so no
  table/seed/state, like the `contacts` domain.
- **`handles/check.ts`** is the shared directory helper used by all three new
  domains: `checkHandle`, `handleUserId`, `handleProfile`, `personHandle`,
  `handleProfileForId`, mirroring web's `mockHandleUserId`/`mockHandleProfile`/
  `mockPersonHandle`/`mockHandleProfileForId`. `taken_user` resolves to the
  seed's Ana (`ana@zilar.test`); other valid free handles resolve to
  `u-handle-<name>` strangers.
- **`me/routes.ts`**: added `PUT /me/handle`, using the same availability rule as
  `checkHandle`; any unavailable handle answers `409` with web's codes
  (`handle_invalid`/`handle_reserved`/`handle_taken`).
- **`domains/index.ts`**: one import and one array entry each, alphabetical
  (`blocks` after `backgrounds`, `contact-requests` before `contacts`, `handles`
  after `groups`).

### Files changed

New: `packages/mock-backend/src/domains/{contact-requests,blocks,handles}/` (13
files). Modified: `packages/mock-backend/src/domains/me/routes.ts`,
`packages/mock-backend/src/domains/index.ts`, this task file. Every file is well
under 400 lines.

### Commands and real results

- `pnpm install`: done (12.2s).
- `pnpm --filter @zilar/mock-backend typecheck`: clean.
- Throwaway proof (temporary test, run then deleted; kept out of the repo):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1067-proof.test.ts`
  → **1 passed**, every response decoded with its contract schema. It had to run
  from `@zilar/web` (not `@zilar/mock-backend`) because the proof needs `effect`
  to decode and the mock-backend package deliberately does not depend on it. The
  file was deleted before the gate, so it is not part of the change.
- `pnpm gate` (repo root):

```
gate: 16 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (3.1s)
PASS  effect  (0.9s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Decoded proof (one line per route, real output)

```
PROOF PUT /me/handle -> 200 {"handle":"ada"}
PROOF GET /me (after claim) handle -> 200 "ada"
PROOF GET /handles/check?handle=taken_user -> 200 {"available":false,"reason":"taken"}
PROOF GET /handles/check?handle=admin -> 200 {"available":false,"reason":"reserved"}
PROOF GET /handles/check?handle=ada_fresh -> 200 {"available":true}
PROOF GET /handles/check?handle=acme&kind=group -> 200 {"available":false,"reason":"taken"}
PROOF GET /users/by-handle/taken_user -> 200 {"userId":"u-ana","name":"Ana","handle":"taken_user","image":null,"relation":"request_received"}
PROOF GET /users/by-handle/some_guy -> 200 {"userId":"u-handle-some_guy","name":"Some guy","handle":"some_guy","image":null,"relation":"none"}
PROOF GET /users/by-handle/admin (404) -> 404 {"error":{"code":"not_found","message":"No user with that username"}}
PROOF POST /contact-requests (reverse) -> 200 {"request":{"id":"cr-seed-1","fromUserId":"u-ana","toUserId":"u-you","status":"pending","createdAt":"2026-10-10T10:00:00.000Z"},"incoming":true}
PROOF POST /contact-requests (new) -> 201 {"request":{"id":"cr-1","fromUserId":"u-you","toUserId":"u-handle-some_guy","status":"pending","createdAt":"2026-10-10T21:46:54.195Z"}}
PROOF GET /contact-requests -> 200 {"incoming":[...],"outgoing":[...]}
PROOF POST /contact-requests/:id/accept -> 200 {"request":{"id":"cr-seed-1",...,"status":"accepted","decidedAt":"2026-10-10T21:46:54.198Z"}}
PROOF POST /contact-requests/:id/decline (decided -> 404) -> 404 {"error":{"code":"not_found","message":"Not found"}}
PROOF DELETE /contact-requests/:id (cancel) -> 200 {"request":{"id":"cr-1",...,"status":"cancelled","decidedAt":"2026-10-10T21:46:54.201Z"}}
PROOF PUT /blocks/:userId -> 200 {"blocked":true}
PROOF PUT /blocks/:userId (unknown -> 404) -> 404 {"error":{"code":"not_found","message":"No user with that id"}}
PROOF GET /blocks -> 200 {"blocked":[{"userId":"u-ana","name":"Ana","handle":"taken_user","image":null,"jid":"u-ana@zilar.test"}]}
PROOF GET /users/by-handle/block_me (blocked) -> 200 {"userId":"u-handle-block_me","name":"Block me","handle":"block_me","image":null,"relation":"blocked"}
PROOF DELETE /blocks/:userId -> 200 {"blocked":false}
```

Every response above was passed through its contract schema
(`ClaimedHandle`, `HandleCheck`, `HandleProfile`, `ContactRequestResult`,
`ReverseContactRequestResult`, `ContactRequestList`, `BlockResult`, `BlockedList`)
with `Schema.decodeUnknownSync`; all decoded.

### Deviations / notes

- **`PUT /me/handle` persistence.** Web does `state.me = { ...state.me, handle }`.
  `me/state.ts` is *not* in the Allowed files, and the `me` domain's only mutator
  is `renameMe`, so `me/routes.ts` writes the viewer row in place with
  `Object.assign(data.me, { handle })`. The row is owned by the `me` state (which
  clones the seed), and `renameMe` copies the row, so the claimed handle survives
  and a `reset()` still rebuilds from the seed. `GET /me` after a claim returns
  the new handle (proved above). If the lead prefers a `setMeHandle` mutator in
  `me/state.ts`, that file needs adding to the Allowed files.
- **`decidedAt` on accept/decline/cancel.** Web's mock omits it; the contract
  says it "is absent until the request is decided", and the real server sets it,
  so the decided row carries it. It decodes either way.
- **Blocked list `jid`.** Uses web's `${userId}@zilar.test` (and `me.jid` for the
  viewer), which is why the proof shows `u-ana@zilar.test` rather than the seed
  person's `ana@zilar.test`. Mirrors web on purpose.
- No app files changed, no tests committed (spec §4).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:** new `contact-requests` (with `GET /users/by-handle/:handle`), `blocks` and `handles` (`GET /handles/check`) domains in `@zilar/mock-backend`, and `PUT /me/handle` in the `me` domain. Only that package changed, and the worker decoded every response with its contract schema.
- **Web side effect:** web mock mode asks the backend first, so these routes now answer from here instead of `apps/web/src/mock/api.ts`. The new seeds match web's: `contactRequests: []` (`api.ts:919`) and `blockedUsers: []`.
- **The follow-up:** `PUT /me/handle` writes the viewer row in place with `Object.assign` (`me/routes.ts:50`), because `me/state.ts` has no handle setter. It works today, but it breaks the replace-not-mutate convention. A small later task can add a setter.
- **The nit:** `data.me.jid ?? null` in `blocks/routes.ts:60` is a dead fallback.
- **Next:** mobile contacts, profile and directory can move onto the backend now, and web W10 can delete these routes after T-1068.
- **Check:** the gate passed.
