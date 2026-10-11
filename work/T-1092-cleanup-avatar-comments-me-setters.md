---
id: T-1092
title: "Cleanup: 'dither' comments now say ball avatar; mobile mock/load.ts header; mock me state gets handle/avatar setters instead of Object.assign"
status: todo
milestone: M5
branch: task/T-1092-cleanup-avatar-comments-me-setters
model: auto
effort: default
depends_on: [T-1091]
estimate: 0.1 day
---

# T-1092: Small leftovers from T-1067, T-1076, T-1084 and T-1091

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11).

**1. Stale "dither" wording.** Since T-1091 the fallback is the glossy ball (`@zilar/ball-avatar`), but these comments still say "dither":
- `apps/web/src/components/Avatar.tsx:9`;
- `apps/mobile/src/components/chat/avatar.tsx:12`, `:17`;
- `apps/mobile/src/components/settings/use-profile-api.ts:33`;
- `apps/mobile/src/components/profile/profile-view.tsx:258`;
- `apps/mobile/src/components/nav/floating-tab-bar.tsx:46`, `:67`, `:105`, `:156`, `:159`.

**2. A stale header.** `apps/mobile/src/mock/load.ts:4` says the load scenario follows "the `EXPO_PUBLIC_ZILAR_MOCK_DRAFT` convention", but T-1084 deleted `mock/drafts.ts`, which read that variable.

**3. The viewer row is written in place.** In the mock backend, `packages/mock-backend/src/domains/me/routes.ts:50` and `packages/mock-backend/src/domains/avatars/routes.ts:51`, `:62` write it with `Object.assign(data.me, …)`.
- `me/state.ts:5-15` has only `renameMe`, which copies the row (`let me`, `:7`).
- The delete path leaves `avatarUrl: undefined` on the row (the T-1076 nit).

### What to build
1. **Rewrite those comments** to say "ball avatar", keeping each comment's meaning. Change no code in those files.
2. **Reword the `load.ts` header** so it no longer cites the deleted drafts convention. It is a comment only.
3. **Add two mutators** next to `renameMe` in the me state: `setMeHandle(handle: string)` and `setMeAvatarUrl(url: string | undefined)`.
   - Each copies the row, like `renameMe`. `undefined` removes the key.
   - Declare them where `renameMe` is declared on `MockData` (find it with `grep`).
   - Use them at `me/routes.ts:50` and `avatars/routes.ts:51`, `:62`, and delete the `Object.assign` calls and their comments.
4. **Proof in the Report:** a throwaway script, not committed, run against `createMockBackend()`:
   - `PUT /api/me/handle` with `ada_fresh`, then `GET /api/me` shows the handle;
   - a `PUT` of a user avatar for the viewer, then `GET /api/me` has `avatarUrl`;
   - a `DELETE` of it, then `GET /api/me` has no `avatarUrl` key.
5. **No tests,** and no other files change.

### Read first
`AGENTS.md` and the files named above.

### Allowed files
`apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/mock/load.ts`, `packages/mock-backend/src/domains/me/state.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `packages/mock-backend/src/domains/me/index.ts`, `packages/mock-backend/src/domains/avatars/routes.ts`, `packages/mock-backend/src/state.ts`, `work/T-1092-cleanup-avatar-comments-me-setters.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 4.

---

## Report (written by the worker when done)

## Review (written by Claude)
