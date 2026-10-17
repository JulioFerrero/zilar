---
id: T-1890
title: "Media D1: card media lives on the avatar volume — CARD_MEDIA_STORAGE_DIR: /data/avatars/card-media in all three compose files next to BACKGROUND_STORAGE_DIR, plus the LAYOUT.md row and the .env.example note"
status: merged
milestone: M5
branch: task/T-1890-card-media-volume
model: auto
effort: default
depends_on: [T-1862]
estimate: 15 min
---

# T-1890: Card media survives deploys (media plan D1)

## Spec (written by Claude, do not edit)

### Why
AI card photos and files (`fetch_media`, `save_text_media`) are stored under `CARD_MEDIA_STORAGE_DIR`, which defaults to `./data/card-media` (`apps/server/src/config/server-schema.ts:64`). That is inside the container, so every deploy wipes them and old cards show grey tiles. **Julio approved on 2026-10-17** putting them on the existing avatar volume, exactly as the chat backgrounds already are.

### Facts (read by the lead on 2026-10-17)
- **`BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds`** is a fixed value, with a comment block above it, in three compose files:
  - `deploy/coolify/docker-compose.app.yml:186` (the live file);
  - `deploy/coolify/docker-compose.yml:176`;
  - `deploy/docker-compose.yml:167`.
- **`deploy/coolify/LAYOUT.md:184`** has its table row (`fixed /data/avatars/backgrounds`).
- **`deploy/.env.example:183-184`** explains it ("Background wallpapers: same avatar volume…").
- **The server creates and checks the directory at boot** (`apps/server/src/startup/boot.ts:120-121`, `ensureWritableDir`), so no setup step is needed.

### Steps
1. **In each of the three compose files,** add right after the `BACKGROUND_STORAGE_DIR` line:
   ```yaml
         # T-1890: AI card photos and files (media plan D1) share the same
         # `avatar-data` volume, so they survive deploys. Fixed, like the
         # backgrounds: a different value orphans stored card media.
         CARD_MEDIA_STORAGE_DIR: /data/avatars/card-media
   ```
2. **`LAYOUT.md`:** add a row after `BACKGROUND_STORAGE_DIR`: `CARD_MEDIA_STORAGE_DIR` | zilar-server | fixed `/data/avatars/card-media`. Keep the table's column padding.
3. **`.env.example`:** after the background sentence, add "AI card media: same avatar volume (CARD_MEDIA_STORAGE_DIR=/data/avatars/card-media, fixed)."
4. **No code or test changes.**

### Allowed files
- `deploy/coolify/docker-compose.app.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/docker-compose.yml`
- `deploy/coolify/LAYOUT.md`
- `deploy/.env.example`
- `work/T-1890-card-media-volume.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **All three compose files set `CARD_MEDIA_STORAGE_DIR: /data/avatars/card-media`** next to the backgrounds line.
- The docs say so.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `CARD_MEDIA_STORAGE_DIR: /data/avatars/card-media` with the spec's three-line
  comment block, directly after the `BACKGROUND_STORAGE_DIR` line, in all three compose
  files: `deploy/coolify/docker-compose.app.yml` (now line 190), `deploy/coolify/docker-compose.yml`
  (line 180) and `deploy/docker-compose.yml` (line 171).
- `deploy/coolify/LAYOUT.md`: added the `CARD_MEDIA_STORAGE_DIR` row right after
  `BACKGROUND_STORAGE_DIR` (line 185), with the same column padding as the neighbours
  (cells padded to 40 / 76 / 112 chars, row length 232 like the background row).
- `deploy/.env.example`: extended the storage-safety block so the background sentence is
  followed by "AI card media: same avatar volume
  (`CARD_MEDIA_STORAGE_DIR=/data/avatars/card-media`, fixed)." Reflowed the following
  GIFs/voice sentences to keep the comment under 80 columns.
- No code, config-schema or test changes, as the spec requires.

### Checks run

- `pnpm install` — Done in 12.6s; only the pre-existing `@types/react-dom`/`@types/react`
  peer warning in `apps/mobile`.
- YAML sanity check (`node` + the workspace `yaml` package, `yaml.parse` on each compose
  file): all three parse, and the `server` service's environment has
  `CARD_MEDIA_STORAGE_DIR=/data/avatars/card-media`.
- `pnpm gate` (repo root) — real summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (1.5s)
  PASS  lint  (2.2s)
  PASS  typecheck  (2.1s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change touches no code, so there were none near it.

### Notes for the lead

- No environment file or secret was read or changed; only `.env.example` (placeholders).
- The variable keeps the server's existing default in `apps/server/src/config/server-schema.ts`
  (`./data/card-media`); these compose values are overrides, so local `pnpm dev` behaviour
  is unchanged.
- Nothing blocked, no deviations, no open questions.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `8fe35014f`.
- **The compose files:** all three set `CARD_MEDIA_STORAGE_DIR: /data/avatars/card-media` right after the backgrounds line. LAYOUT.md and `.env.example` say so. Julio approved D1 at 17:35.
- **The shared volume is safe:** the avatar route serves only `avatars` rows by `storage_key` (`apps/server/src/avatars/read.ts:25,58`), so card-media files can't be fetched through it, the same as backgrounds.
- **After deploy:** check that the server log shows no `CARD_MEDIA_STORAGE_DIR` boot error. Then a card photo should still show after the next deploy.
