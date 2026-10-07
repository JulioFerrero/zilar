---
id: T-0473
title: "Env examples: document AVATAR_STORAGE_DIR and BACKGROUND_STORAGE_DIR (and correct the storage note)"
status: todo
milestone: M5
branch: task/T-0473-env-examples-storage
model: auto
effort: low
depends_on: [T-0471]
estimate: 0.1 day
---

# T-0473: storage dirs in the env examples

## Spec (written by Claude, do not edit)

### Why
This is the T-0471 pre-review follow-up. `docs/audit/release-readiness.md` §2b says neither `.env.example` lists `AVATAR_STORAGE_DIR` or `BACKGROUND_STORAGE_DIR`.

### Verified facts (do not re-derive)
- **`apps/server/src/config.ts`:**
  - `AVATAR_STORAGE_DIR` defaults to `./data/avatars` (line 72);
  - `BACKGROUND_STORAGE_DIR` defaults to `./data/backgrounds` (line 77).
- **`deploy/docker-compose.yml`** fixes them to `/data/avatars` and `/data/avatars/backgrounds`. The backgrounds dir lives on the `avatar-data` volume.
- **`deploy/.env.example:176-184`** is the "Storage safety (T-0151)" comment block. It names the attachments and sticker volumes and says `./zilar backup` archives "BOTH file volumes (uploads.tgz + stickers.tgz…)". It doesn't mention avatars, which the backup also covers (`docs/RELEASING.md` §5, as fixed by T-0471), and it says "Voice: not built", which is no longer true.
- **`apps/server/.env.example`** has no storage dir lines at all. Run `grep -n STORAGE apps/server/.env.example` to confirm.

### What to change
1. **`deploy/.env.example`:** in the storage block, add:
   - avatars: the `avatar-data` volume, `AVATAR_STORAGE_DIR=/data/avatars`, fixed;
   - background wallpapers: `BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds` on the same volume.
   
   Also:
   - correct the backup sentence so it lists `avatars.tgz` too (check the real archive names in the `zilar` backup script before writing them);
   - replace "Voice: not built" with where voice notes live (they are attachments on the upload volume; check this with `docs/INSTALL_DOCKER.md` as fixed by T-0471).
   
   These are comments only, because compose sets the values.
2. **`apps/server/.env.example`:** add commented lines with their defaults and one-line comments, next to the other path or storage settings, or at the end if there are none:
   ```
   # STICKER_STORAGE_DIR=./data/stickers
   # AVATAR_STORAGE_DIR=./data/avatars
   # BACKGROUND_STORAGE_DIR=./data/backgrounds
   ```
   **Only add a line** if that var is really read by `apps/server/src/config.ts` (check it).

### Read first
`AGENTS.md`, `deploy/.env.example:160-190`, `apps/server/.env.example`, `apps/server/src/config.ts:60-80`, the backup part of the `zilar` script (`grep -n "tgz" zilar` or wherever `./zilar backup` is implemented), `docs/INSTALL_DOCKER.md` (the storage table).

### Allowed files
`deploy/.env.example`, `apps/server/.env.example`, `work/T-0473-env-examples-storage.md`.

If a config or env test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm gate
```

### Acceptance
- Both env examples document the avatar and background storage dirs.
- The deploy storage note matches the real backup archives and the voice storage.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
