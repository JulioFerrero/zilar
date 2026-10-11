---
id: T-1092
title: "Cleanup: 'dither' comments now say ball avatar; mobile mock/load.ts header; mock me state gets handle/avatar setters instead of Object.assign"
status: merged
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

### What I did

1. **"dither" → "ball avatar" wording** (comments only, no code changed):

   - `apps/web/src/components/Avatar.tsx:9` — "the dither avatar no longer changes for AIs" → "the ball avatar no longer changes for AIs".
   - `apps/mobile/src/components/chat/avatar.tsx:12` (same phrase) and `:17` ("The dither avatar circle and the online dot." → "The ball avatar circle and the online dot.").
   - `apps/mobile/src/components/settings/use-profile-api.ts:33` — "fall back to the dither" → "fall back to the ball avatar".
   - `apps/mobile/src/components/profile/profile-view.tsx:258` — "sticking on the dither until remount" → "sticking on the ball avatar until remount".
   - `apps/mobile/src/components/nav/floating-tab-bar.tsx:46, :67, :105, :156, :159` — all five now say "ball avatar" (e.g. "clears the ball avatar fallback", "a ball avatar when present", "the ball avatar fallback", "falls back to a ball avatar", "sticking on the ball avatar until remount").

2. **`apps/mobile/src/mock/load.ts` header** — dropped ", following the `EXPO_PUBLIC_ZILAR_MOCK_DRAFT` convention (T-0056)" so it no longer cites the deleted drafts convention. Comment only.

3. **Me-state setters.** In `packages/mock-backend/src/domains/me/state.ts` I widened the internal row to `MockMe & { avatarUrl?: string | undefined }` (the picture url is not on `MockMe`; `avatarUrl` is written by the avatar routes and `undefined` is dropped from `GET /me` by `JSON.stringify`), then added next to `renameMe`:

   - `setMeHandle(handle: string)` — `me = { ...me, handle }`;
   - `setMeAvatarUrl(url: string | undefined)` — `me = { ...me, avatarUrl: url }` (passing `undefined` drops the key from the serialized row).
   Both copy the row, like `renameMe`. The stale "the only mutation this route group needs" comment was replaced.

   Declared both on `MockData` in `packages/mock-backend/src/state.ts`, next to `renameMe`, with short doc comments.

   Callers switched:
   - `me/routes.ts:50` — `Object.assign(data.me, { handle: raw })` + its comment replaced by `data.setMeHandle(raw);` (kept a one-line note that the setter copies the row).
   - `avatars/routes.ts:51` — `Object.assign(data.me, { avatarUrl: url })` → `data.setMeAvatarUrl(url);`.
   - `avatars/routes.ts:62` — `Object.assign(data.me, { avatarUrl: undefined })` → `data.setMeAvatarUrl(undefined);` (the old `JSON.stringify` comment reworded to say the setter drops the key).

   `me/index.ts` was in the Allowed files but needed no change (the state factory wiring was already correct).

### Proof (step 4)

Throwaway Vitest file `packages/mock-backend/src/__t1092-proof.test.ts` against `createMockBackend({ delayMs: 0 })`, run once and then deleted (not committed). Real stdout:

```
PUT handle -> 200 {"handle":"ada_fresh"}
GET /me after handle -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":"ada_fresh","jid":"you@zilar.test"}
PUT avatar -> 200 {"url":"data:image/png;base64,iVBORw=="}
GET /me after avatar -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":"ada_fresh","jid":"you@zilar.test","avatarUrl":"data:image/png;base64,iVBORw=="}
DELETE avatar -> 200 {"ok":true}
GET /me after delete -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":"ada_fresh","jid":"you@zilar.test"}
```

All three conditions hold: the handle shows after `PUT /api/me/handle`, `avatarUrl` appears after the viewer `PUT`, and it is absent (no `avatarUrl` key) after the `DELETE`.

### Commands run

- `pnpm install` → done in 11.4s (1.172 added, peer warning `@types/react-dom`/`@types/react` pre-existing).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1092-proof.test.ts` → 1 file passed, 1 test passed (output above); file then deleted.
- `pnpm gate` (repo root) summary:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (4.2s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/mock-backend (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The three touched packages have no nearby test files, hence the SKIPs; the throwaway proof above is the only test run.

### Files changed

`apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/mock/load.ts`, `packages/mock-backend/src/domains/me/state.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `packages/mock-backend/src/domains/avatars/routes.ts`, `packages/mock-backend/src/state.ts`, `work/T-1092-cleanup-avatar-comments-me-setters.md`.

### Deviations / open questions

- No tests were added (per spec). No dependencies added.
- `MockMe` (`data/people.ts`) has no `avatarUrl` field and that file is outside the Allowed list, so the field is typed locally in `me/state.ts` as `MockMe & { avatarUrl?: string | undefined }`. If the lead would rather add `avatarUrl` to `MockMe` itself, that is a one-line follow-up; nothing else needs to change.
- No other deviations; no blockers.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:**
  - the "dither" comments now say ball avatar, as comments only;
  - the mobile `mock/load.ts` header no longer cites the deleted drafts convention;
  - the mock me state has `setMeHandle` and `setMeAvatarUrl`, which copy the row like `renameMe`, and they replace the three `Object.assign` writes.
- **The proof** (the worker's throwaway script): `GET /me` shows `handle: "ada_fresh"`, then an `avatarUrl` after the viewer upload, then no `avatarUrl` key after the delete.
- **The nit, accepted:** in memory, `setMeAvatarUrl(undefined)` keeps the key with the value `undefined`, and JSON drops it on the wire. This is mock-only.
- **The follow-up:** `MockMe` (`data/people.ts`) has no `avatarUrl` field, so it is typed locally in `me/state.ts`.
- **Check:** the gate passed. The app files changed only comments, so the lead ran no UI check.
