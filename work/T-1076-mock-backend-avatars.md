---
id: T-1076
title: "Mock backend F5: avatars domain (PUT/DELETE /avatars/:kind/:ownerId) whose urls show without a server; /me carries the viewer's avatarUrl"
status: merged
milestone: M5
branch: task/T-1076-mock-backend-avatars
model: auto
effort: default
depends_on: [T-1074]
estimate: 0.25 day
---

# T-1076: Avatars in the shared mock backend

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11):
- **The server** (`apps/server/src/avatars/api.ts:45-66`):
  - `PUT /api/avatars/:kind/:ownerId` returns `{ url: string }`;
  - `DELETE` the same path returns `{ ok: true }`;
  - `GET /api/avatars/:id` serves the bytes;
  - an unknown kind answers 404 `not_found`.
- **The web client** (`apps/web/src/lib/api/settings.ts:188-205`) uploads the raw `Blob` with kind `user`, `ai` or `group`.
- **`@zilar/mock-backend` has no `avatars` domain** (`packages/mock-backend/src/domains/`). Since T-1074, web mock mode answers 404 for these routes (`apps/web/src/mock/backend.ts`).
- **Mock routes are synchronous** (`MockRoute` in `packages/mock-backend/src/http/shared.ts:19`), so a route cannot `await blob.arrayBuffer()`.
- **No server to serve images:** a url like `/api/avatars/<id>` would go to vite and get a 404. That is the same problem as the blank sticker images on the BOARD.
- **Which urls show anywhere:**
  - web's CSP allows `data:` and `blob:` images;
  - mobile's `avatarImageSource` passes `data:` urls through unchanged (`apps/mobile/src/components/settings/profile-logic.ts:156`).
- **`/me`:** the contract's `AuthMe` has an optional `avatarUrl` (`packages/api-contract/src/auth.ts:51`). The mock viewer row `MockMe` (`packages/mock-backend/src/data/people.ts:32-39`) has none, and `GET /me` returns `data.me` (`packages/mock-backend/src/domains/me/routes.ts:20`).

### What to build
1. **A new domain** `packages/mock-backend/src/domains/avatars/` (`index.ts`, `routes.ts`, `state.ts`), in the shape of `pins`, plus one alphabetical line in `domains/index.ts`. The state is a map from `kind:ownerId` to url.
2. **`PUT /avatars/:kind/:ownerId`** (kind `user`, `ai` or `group`; anything else is a 404 `not_found`).
   - **The url, synchronously:**
     - a `Blob` body with `URL.createObjectURL` available becomes `URL.createObjectURL(body)`;
     - a `string`, `ArrayBuffer` or `Uint8Array` body becomes `data:<content-type header or image/png>;base64,<btoa of the bytes>`;
     - an empty or missing body answers 400 `avatar_empty`, as the server does.
   - **Store** the url and answer `{ url }`.
   - **The viewer's own avatar:** when kind is `user` and `ownerId === data.me.id`, also set `avatarUrl` on the viewer row the way `me/routes.ts:47-50` writes `handle` (`Object.assign`), so `GET /me` returns it.
3. **`DELETE /avatars/:kind/:ownerId`** removes the url and answers `{ ok: true }`. For the viewer, it removes `avatarUrl` from the row.
4. **`GET /avatars/:id`** answers 404 `not_found`, because every mock url is a `data:` or `blob:` url.
5. **Proof in the Report:** run a throwaway script, not committed, against `createMockBackend()`. Decode each response with the contract or server schema, and show `GET /me` before and after the upload and after the delete. Do not add tests. If decoding needs `effect`, run it from `@zilar/web`, as T-1067 did.
6. **Scope:** no app files change, and every file is under 400 lines.

The lead's web check (`?mock=1`): Settings › Profile › Add picture with a PNG, then the avatar shows; Remove, then the dither shows.

### Read first
`AGENTS.md`, `packages/mock-backend/src/domains/pins/`, `packages/mock-backend/src/domains/me/routes.ts`, `packages/mock-backend/src/http/shared.ts`, `apps/server/src/avatars/api.ts`, and `apps/web/src/lib/api/settings.ts:180-206`.

### Allowed files
`packages/mock-backend/src/domains/avatars/index.ts`, `packages/mock-backend/src/domains/avatars/routes.ts`, `packages/mock-backend/src/domains/avatars/state.ts`, `packages/mock-backend/src/domains/index.ts`, `work/T-1076-mock-backend-avatars.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the decoded proof, including `/me` before, after the upload and after the delete.

---

## Report (written by the worker when done)

### What I did

Added the `avatars` domain to `@zilar/mock-backend`, mirroring the server's
`apps/server/src/avatars/api.ts` for the parts a serverless mock can serve:

- New `packages/mock-backend/src/domains/avatars/state.ts`: the live table is a
  `Map<string, string>` from `${kind}:${ownerId}` to the stored url, exposed on
  `MockData` via module augmentation (`avatarUrls`, `putAvatarUrl`,
  `removeAvatarUrl`). It starts empty and there is no seed.
- New `packages/mock-backend/src/domains/avatars/routes.ts`:
  - `PUT /avatars/:kind/:ownerId` (kind `user`, `ai` or `group`; anything else
    is 404 `not_found`). Body handling is synchronous, as `MockRoute` requires:
    a `Blob` body becomes `URL.createObjectURL(body)` (web's upload path); a
    `string`/`ArrayBuffer`/`Uint8Array` body becomes
    `data:<content-type header or image/png>;base64,<bytes>`. A missing or
    empty body answers 400 `avatar_empty`. The url is stored and answered as
    `{ url }` (200).
  - The viewer's own picture also writes `avatarUrl` on the `me` row
    (`Object.assign`, like `PUT /me/handle` writes `handle`), so `GET /me`
    carries it.
  - `DELETE /avatars/:kind/:ownerId` removes the url and answers `{ ok: true }`;
    for the viewer it clears `avatarUrl` (set to `undefined`, which
    `JSON.stringify` drops).
  - `GET /avatars/:id` always answers 404 `not_found`: every mock url is a
    `data:` or `blob:` url.
- New `packages/mock-backend/src/domains/avatars/index.ts`: `defineDomain`.
- `packages/mock-backend/src/domains/index.ts`: one alphabetical import line
  and one alphabetical array entry (`avatarsDomain`).

No app file changed. Every new file is well under 400 lines.

### Files changed

- New: `packages/mock-backend/src/domains/avatars/{index,routes,state}.ts`
- Modified: `packages/mock-backend/src/domains/index.ts` (two lines)
- Modified: `work/T-1076-mock-backend-avatars.md`

### Commands and real results

- `pnpm install`: done (9.6s).
- Throwaway proof (temporary test, deleted before the gate, kept out of the
  repo): `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1076-proof.test.ts`
  → **1 passed**. Run from `@zilar/web` (as T-1067 did) because decoding each
  response with its Effect schema needs `effect`, which the mock-backend
  package deliberately does not depend on.
- `pnpm gate` (repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (0.9s)
PASS  lint  (0.7s)
PASS  typecheck  (1.6s)
PASS  effect  (0.4s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Decoded proof (real output)

`GET /me` decoded with the contract's `AuthMe`; the other bodies decoded with
`{ url: string }`, `{ ok: true }` and `{ error: { code } }` schemas.

```
PROOF GET /me before -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":null,"jid":"you@zilar.test"}
PROOF PUT /avatars/user/:id (Blob) -> 200 {"url":"blob:mock-avatar"}
PROOF GET /me after upload -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"avatarUrl":"blob:mock-avatar","handle":null,"jid":"you@zilar.test"}
PROOF DELETE /avatars/user/:id -> 200 {"ok":true}
PROOF GET /me after delete -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":null,"jid":"you@zilar.test"}
PROOF PUT /avatars/ai/:id (bytes) -> {"url":"data:image/png;base64,iVBORw0KGgo="}
PROOF GET /avatars/:id -> 404 {"error":{"code":"not_found"}}
PROOF PUT /avatars/robot/:id -> 404 {"error":{"code":"not_found"}}
PROOF PUT /avatars/group/:id (empty) -> 400 {"error":{"code":"avatar_empty"}}
```

The proof stubs `URL.createObjectURL` because jsdom's own implementation cannot
read a `Blob`; a real browser (the lead's `?mock=1` check) can, and the route
calls it (asserted `toHaveBeenCalledTimes(1)`).

### Deviations and notes

- The module augmentation lives in `state.ts`, not a separate `tables.ts`:
  the Allowed files list `index.ts`, `routes.ts` and `state.ts` only.
- `ownerId` is decoded with a bare `decodeURIComponent(ownerId)`, like the
  `pins` and `backgrounds` mock routes, instead of the server's
  try/catch-to-404. A malformed percent escape would therefore throw rather
  than answer 404; the spec does not ask for the server's malformed-escape
  handling, and a `try` in this package trips the gate's effect ratchet (W4).
- `GET /avatars/:id` returns 404 for every id, so the stored `blob:`/`data:`
  urls are the only way an image is served — which is the point (no server).

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 3 nits, all mock-only.**
- **The change:** a new `avatars` domain in `@zilar/mock-backend`:
  - **`PUT`:** a `Blob` becomes a `blob:` url, and bytes or a string become a `data:` url; an empty body answers 400 `avatar_empty`;
  - **`DELETE`** answers `{ ok: true }`, and `GET /avatars/:id` answers 404;
  - **the viewer's own avatar** sets or clears `avatarUrl` on `/me`.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - Settings › Profile › Add picture with a 128 px PNG opens the crop dialog;
  - Save picture shows the picture, with Change picture and Remove;
  - Remove brings back the fallback and Add picture. The branch predates T-1075, so the fallback is still the letter.
- **The nits:**
  - a malformed `%` escape in `ownerId` throws instead of answering 404;
  - delete leaves `avatarUrl: undefined` on the row, which JSON drops;
  - replaced `blob:` urls are not revoked.
- **Check:** the gate passed.
