---
id: T-1067
title: "Mock backend F3: contact-requests (with users/by-handle), blocks, handles/check and PUT /me/handle domains in @zilar/mock-backend"
status: todo
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

## Review (written by Claude)
