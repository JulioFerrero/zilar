---
id: T-1054
title: "Dedup F6 (S5): one readCapped (apps/server/src/http/read-capped.ts) for the sticker, background, voice and avatar uploads"
status: todo
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

## Review (written by Claude)
