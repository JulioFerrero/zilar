---
id: T-0473
title: "Env examples: document AVATAR_STORAGE_DIR and BACKGROUND_STORAGE_DIR (and correct the storage note)"
status: merged
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

### What I did
Updated both env examples so the avatar and background storage dirs are
documented, and corrected the deploy storage note to match the real backup
archives and the voice storage.

- **`deploy/.env.example`** (storage safety block, comments only — compose sets
  the values): added avatars (`avatar-data` volume,
  `AVATAR_STORAGE_DIR=/data/avatars`, fixed) and background wallpapers (same
  volume, no separate volume, `BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds`,
  fixed). Rewrote the backup sentence to name all three file volumes
  (`uploads.tgz + stickers.tgz + avatars.tgz`) and replaced "Voice: not built"
  with "not stored separately — the recording is sent as a normal attachment on
  the upload volume", matching `docs/INSTALL_DOCKER.md` §"Storage, quotas, disk".
- **`apps/server/.env.example`**: appended a commented storage block with the
  defaults for `STICKER_STORAGE_DIR`, `AVATAR_STORAGE_DIR` and
  `BACKGROUND_STORAGE_DIR`, each with a one-line comment. All three are really
  read by `apps/server/src/config.ts` (lines 67, 72, 77), so all three lines are
  included.

### Files changed
- `deploy/.env.example`
- `apps/server/.env.example`
- `work/T-0473-env-examples-storage.md` (status + this report)

### Commands and real results
- `grep -n STORAGE apps/server/.env.example` → no matches before the change
  (confirmed the file had no storage dir lines).
- `grep -n "tgz" deploy/zilar` → backup writes `uploads.tgz`, `stickers.tgz`
  and `avatars.tgz` (lines 926-928, 965-969, 991).
- `grep -n ... deploy/docker-compose.yml` → `AVATAR_STORAGE_DIR: /data/avatars`
  (line 148), `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds` (line 153),
  `avatar-data` volume at `/data/avatars` (line 218).
- `pnpm install` → done in 19.3s, exit 0.
- `pnpm gate` → exit 0, output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (27.6s)
  PASS  lint  (1.4s)
  PASS  typecheck  (19.8s)
  PASS  tests @zilar/server  (2.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No file outside the Allowed files.

### Problems / deviations
None. No config or env test broke. Comments/example lines only; no code change.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-07). Both env examples now document the sticker, avatar and background storage dirs. The deploy storage note lists avatars.tgz and says where voice notes live. Pre-review clean.
