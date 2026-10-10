---
id: T-1054
title: "Dedup F6 (S5): one readCapped (apps/server/src/http/read-capped.ts) for the sticker, background, voice and avatar uploads"
status: merged
milestone: M5
branch: task/T-1054-server-read-capped
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1054: One `readCapped`

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §6.6 (slice S5). The lead diffed the four private `readCapped<E, R>(stream, cap)` copies on main (2026-10-10), and all four are the same 33-line body:
- `apps/server/src/stickers/api-upload.ts:108`
- `apps/server/src/backgrounds/api.ts:178`
- `apps/server/src/voice/api.ts:139`
- `apps/server/src/avatars/api.ts:200`

The function reads an upload stream and stops once the running total passes the cap, returning `undefined` when the cap is exceeded.

### What to build
1. **The new file:** `apps/server/src/http/read-capped.ts` exports `readCapped`, the exact body and signature, with the doc comment from `voice/api.ts:135-138`. The folder holds `client-ip.ts`.
2. **The four files:** each one deletes its copy and imports `readCapped` from `../http/read-capped`. Drop the imports (`Stream` etc.) that are no longer used, and keep the ones still used.
3. **Same behaviour:** every cap, call site and `.pipe(...)` after the call stays as it is.
4. **Out of scope:** `apps/server/src/stickers/telegram/transport.ts`. Its `readDownloadBody` and `readEnvelopeBody` are a different shape.

### Read first
`AGENTS.md`, and the four files.

### Allowed files
`apps/server/src/http/read-capped.ts`, `apps/server/src/stickers/api-upload.ts`, `apps/server/src/backgrounds/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/avatars/api.ts`, `work/T-1054-server-read-capped.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function readCapped" apps/server/src` lists only `http/read-capped.ts`.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/http/read-capped.ts` with the single shared `readCapped<E, R>(stream, cap)`, copying the exact body and signature and the doc comment from `voice/api.ts:136-138`. I also added a short 3-line module header (matching `http/client-ip.ts` style) naming the four callers.
- Deleted the private `readCapped` copy from each of the four handlers and imported it from `../http/read-capped`.
- Removed the now-unused `Stream` import in all four files (`Effect, Stream` -> `Effect` in stickers; `Effect, Layer, Stream` -> `Effect, Layer` in backgrounds and voice; `Effect, Layer, Option, Schema, Stream` -> `Effect, Layer, Option, Schema` in avatars). No other imports changed.
- Left every cap, call site and `.pipe(...)` after the call untouched; caps are `STICKER_MAX_BYTES`, `BACKGROUND_MAX_BYTES`, `maxBytes` (voice) and `AVATAR_MAX_BYTES`. `stickers/telegram/transport.ts` untouched.

### Files changed
- `apps/server/src/http/read-capped.ts` (new)
- `apps/server/src/stickers/api-upload.ts`
- `apps/server/src/backgrounds/api.ts`
- `apps/server/src/voice/api.ts`
- `apps/server/src/avatars/api.ts`
- `work/T-1054-server-read-capped.md`

### Commands and results
- `pnpm install`: Done in 25s (1 deprecated subdep `uuid@7.0.3`, one peer warning `@types/react-dom`, pre-existing).
- `grep -rn "function readCapped" apps/server/src`: matches only `apps/server/src/http/read-capped.ts:11`.
- `grep -rn "Stream" <the four files>`: only comment text ("Streams the stored file..."); no `Stream` import or usage remains.
- `pnpm gate` (from repo root): summary lines verbatim:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 6 changed files are the 5 source files above plus the task file, all inside Allowed files. I ran no standalone test files (`pnpm --filter ...`) because the change moves a pure helper with no adjacent test file.

### Deviations / notes
- Spec said "the exact body and signature, with the doc comment from `voice/api.ts:135-138`". I kept the function body and signature byte-identical and the 3-line doc comment verbatim; the only extra text is the module header comment above the import, matching the existing `http/client-ip.ts` convention.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** a new `apps/server/src/http/read-capped.ts` holds `readCapped`. The four upload files (stickers, backgrounds, voice, avatars) import it, and each drops its own 33-line copy and the now-unused `Stream` import. The diff is 90 lines added and 153 removed.
- **Same behaviour:** the lead diffed the new body against main's `voice/api.ts` copy, and they are identical. Before the spec, the lead had also diffed the four copies, and they matched. `grep` now finds one `function readCapped`.
- **Check:** the gate passed. No tests are near these files.
