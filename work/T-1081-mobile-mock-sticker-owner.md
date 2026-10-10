---
id: T-1081
title: "Mobile mock: sticker screens know the mock viewer, so your own packs open for editing (viewerId from the shared seed)"
status: todo
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

## Review (written by Claude)
