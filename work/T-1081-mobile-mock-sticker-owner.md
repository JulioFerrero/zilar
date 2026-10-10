---
id: T-1081
title: "Mobile mock: sticker screens know the mock viewer, so your own packs open for editing (viewerId from the shared seed)"
status: merged
milestone: M5
branch: task/T-1081-mobile-mock-sticker-owner
model: auto
effort: default
depends_on: [T-1079]
estimate: 0.1 day
---

# T-1081: Your own sticker packs are editable in mobile mock mode

## Spec (written by Claude, do not edit)

### Why
The lead found this in the T-1079 phone smoke (2026-10-11). In mock mode, opening the Cats pack shows "You can only edit your own packs." The same happened on main before T-1079.
- **The check:** `apps/mobile/src/components/stickers/use-pack-editor.ts:152` marks the pack forbidden when `found.ownerId !== me.id` or `me === null`. Here `me = useAuthStore((state) => state.me)` (`:83`).
  - `apps/mobile/src/components/stickers/use-stickers-panel.ts:53`, `:303` passes `meId: me?.id` to `pack-card.tsx:28`, which shows the owner controls only when `pack.ownerId === meId`.
- **Why it fails in mock mode:** `useAuthStore` `me` is null, because nobody signs in. The backend seeds the packs with `ownerId: currentUser.id` (`packages/mock-backend/src/domains/stickers/seed.ts:113`), which is `'u-you'` (`packages/mock-backend/src/data/people.ts:13-15`).
- **Where to get the id:** `@zilar/mock-backend` exports `defaultSeed` (`packages/mock-backend/src/data/index.ts:51`), whose `me.id` is that viewer id.
- **The hook:** `apps/mobile/src/components/stickers/use-stickers-api.ts` (87 lines, after T-1079) already loads `@/mock/backend` behind the guarded `require` in mock mode.

### What to build
1. **`apps/mobile/src/mock/backend.ts`:** export `mockViewerId`, the `me.id` of `defaultSeed`, with a one-line comment.
   - If `createMockBackend()` here gets no seed and uses a fresh `createSeed()`, the two ids are equal because the seed is deterministic. Confirm that in the Report.
2. **`use-stickers-api.ts`:** the handle gains `viewerId: string | undefined`. It is `mockViewerId` from the same guarded require in mock mode, and `undefined` otherwise.
3. **`use-pack-editor.ts` and `use-stickers-panel.ts`:** use `me?.id ?? viewerId` wherever they use the viewer's id today: the forbidden check at `:152`, and `meId` at `:303`. Nothing else changes. Keep each file under 400 lines; `use-stickers-panel.ts` is at 313.
4. **No tests.** No other files change.

The lead's phone smoke (mock):
- open the Cats pack: Edit pack loads its title and stickers;
- Settings › Stickers shows the owner controls on Cats and Moods.

### Read first
`AGENTS.md`, the files named above, and `packages/mock-backend/src/data/index.ts`.

### Allowed files
`apps/mobile/src/mock/backend.ts`, `apps/mobile/src/components/stickers/use-stickers-api.ts`, `apps/mobile/src/components/stickers/use-pack-editor.ts`, `apps/mobile/src/components/stickers/use-stickers-panel.ts`, `work/T-1081-mobile-mock-sticker-owner.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

**What I did**
- `apps/mobile/src/mock/backend.ts`: added `mockViewerId`, which is `defaultSeed.me.id` from `@zilar/mock-backend`, with a one-line comment.
- `apps/mobile/src/components/stickers/use-stickers-api.ts`: `createMockStickers` now returns `{ api, viewerId }`, taking `mockViewerId` from the same guarded `require('@/mock/backend')`; `StickersApiHandle` gained `viewerId: string | undefined`, set to `mockViewerId` in mock mode and `undefined` otherwise.
- `apps/mobile/src/components/stickers/use-pack-editor.ts`: `const viewer = me?.id ?? viewerId;` and the forbidden check now uses `found.ownerId !== viewer` (was `me === null || found.ownerId !== me.id`).
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`: `meId: me?.id ?? viewerId`.
- No tests and no other files changed.

**Seed determinism (item 1 of the spec)**
Confirmed: `createMockBackend()` here is called with no seed, so its `seed()` falls back to `createSeed()`, while `defaultSeed` is a separate `createSeed()` at module load. The two ids are equal because the id is fixed, not clock-dependent: `me` comes from `defaultMe()` (`packages/mock-backend/src/domains/me/seed.ts:2,6`), which returns `id: currentUser.id`, and `currentUser.id` is the constant `'u-you'` (`packages/mock-backend/src/data/people.ts:13-15`). So `mockViewerId === 'u-you'` and the packs' seeded `ownerId` (`packages/mock-backend/src/domains/stickers/seed.ts:113`) matches it. I did not run any code to prove this; it is read from the source.

**Files changed**
`apps/mobile/src/mock/backend.ts`, `apps/mobile/src/components/stickers/use-stickers-api.ts`, `apps/mobile/src/components/stickers/use-pack-editor.ts`, `apps/mobile/src/components/stickers/use-stickers-panel.ts`, `work/T-1081-mobile-mock-sticker-owner.md`.

**Commands and results**
- `pnpm install`: done (10.6s), one pre-existing peer-dependency warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm gate` (first run): FAIL on `format` (`use-stickers-api.ts`); all else PASS. Fixed with `pnpm exec prettier --write apps/mobile/src/components/stickers/use-stickers-api.ts`, then re-ran.
- `pnpm gate` (final): GATE PASS. Summary lines:
  - `PASS  install (frozen)  (2.6s)`
  - `PASS  format  (1.9s)`
  - `PASS  lint  (2.0s)`
  - `PASS  typecheck  (4.2s)`
  - `PASS  effect  (1.7s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  No single test files were run: the change is UI-only and the spec says no tests.

**Deviations / notes**
- Used `me?.id ?? viewerId` in a local `viewer` constant in `use-pack-editor.ts` (the spec's `me?.id ?? viewerId`); `use-stickers-panel.ts` uses it inline as specified.
- No questions; nothing blocked.

**Fix round (lead, 2026-10-11): mock viewer must win over a stored session**
- Cause: on a device that signed in before, `useAuthStore` `me` is a stored real user even in a mock build, so `me?.id ?? viewerId` chose the real id and never matched the seeded owner `u-you`.
- `use-pack-editor.ts`: `const viewer = viewerId ?? me?.id;`, with the comment updated to say why the mock viewer wins (a stored session from an earlier sign-in may be present). Committed alone.
- `use-stickers-panel.ts`: `meId: viewerId ?? me?.id`. Committed alone.
- Outside mock mode `viewerId` is `undefined`, so real builds still use `me?.id`; nothing else changed.
- Commits: `T-1081: mock viewer id wins in the pack editor` and `T-1081: mock viewer id wins in the stickers panel`.
- `pnpm gate` after both commits: GATE PASS. Summary lines:
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.3s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (2.4s)`
  - `PASS  effect  (0.4s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`

## Review (written by Claude)

**Lead, 2026-10-11: approved after one lead fix round. The pre-review is clean.**
- **The change:**
  - `mock/backend.ts` exports `mockViewerId` (`defaultSeed.me.id`);
  - `useStickersApi` returns it as `viewerId` in mock mode;
  - the pack editor and the panel use `viewerId ?? me?.id`.
- **Fix round:** the first version used `me?.id ?? viewerId`. On the emulator, a mock build still holds the stored real sign-in, so `me` was the real user and the pack read "forbidden". The mock viewer now wins. This is noted in `docs/LEAD_HANDOFF.md`.
- **The lead's phone smoke** (mock): the Cats pack by deep link opens Edit pack with the name Cats, Private / Shared on this server, and Stickers "6 / 120" with Remove controls. Settings › Stickers passes.
- **Check:** the gate passed.
