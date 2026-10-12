---
id: T-1281
title: "Mobile: type `album` on the store's SendAttachmentOptions instead of the local AlbumSendOptions intersection in composer-media (T-1271 follow-up F1)"
status: merged
milestone: M5
branch: task/T-1281-mobile-album-type
model: auto
effort: default
depends_on: [T-1280]
estimate: 0.05 day
---

# T-1281: Type the album option on mobile

## Spec (written by Claude, do not edit)

### Why
T-1271's pre-review follow-up F1 (`work/T-1271-albums-mobile.md`).
- **The mobile type:** `SendAttachmentOptions` in `apps/mobile/src/store/send-types.ts:15-18` has only `caption` and `replyTo`.
- **The workaround:** the composer adds `album` through a local `type AlbumSendOptions = SendAttachmentOptions & { album: AlbumRef }` (`apps/mobile/src/components/chat/composer-media.ts:72`, used at `:232`).
- **Why it works at runtime:** the store passes the options object straight to client-core (`apps/mobile/src/store/effects/send.ts:144`), whose type already has `album?: AlbumRef` (`packages/client-core/src/store/send/context.ts:41`).

### What to build
1. Add `album?: AlbumRef` to the mobile `SendAttachmentOptions` (import `AlbumRef` from `@zilar/chat-core`).
2. Remove `AlbumSendOptions` from `composer-media.ts` and use `SendAttachmentOptions` at `:232`.
3. No behaviour change and no tests.

### Allowed files
`apps/mobile/src/store/send-types.ts`, `apps/mobile/src/components/chat/composer-media.ts`, `work/T-1281-mobile-album-type.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `album?: AlbumRef` to the mobile store's `SendAttachmentOptions` in `apps/mobile/src/store/send-types.ts` (and imported `AlbumRef` from `@zilar/chat-core`), matching client-core's `SendAttachmentOptions` (`packages/client-core/src/store/send/context.ts:41`).
- Removed the local `AlbumSendOptions = SendAttachmentOptions & { album: AlbumRef }` intersection and its explanatory comment from `apps/mobile/src/components/chat/composer-media.ts`, and switched the album options at the send site to `SendAttachmentOptions`. The now-unused `import type { AlbumRef }` was also removed from the composer.
- No behaviour change, no tests added (UI-only type change, as the spec says).

### Files changed
- `apps/mobile/src/store/send-types.ts`
- `apps/mobile/src/components/chat/composer-media.ts`
- `work/T-1281-mobile-album-type.md`

### Commands and results
- `pnpm install`: Done, no errors.
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (3.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I ran no single test files: the change is a type-only refactor with no test per the spec, and `pnpm gate` was run once from the repo root.

### Problems / deviations
- None.

### Blocked / needs a decision
- None.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (0 nits).** A type-only change: `album?: AlbumRef` is on the mobile `SendAttachmentOptions`, and the local intersection in `composer-media.ts` is gone. Mobile tsc after the rebase: 0 errors.
