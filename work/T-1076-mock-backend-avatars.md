---
id: T-1076
title: "Mock backend F5: avatars domain (PUT/DELETE /avatars/:kind/:ownerId) whose urls show without a server; /me carries the viewer's avatarUrl"
status: todo
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

## Review (written by Claude)
