---
id: T-0471
title: "Docs catch-up from the release audit: FEATURES, USER_GUIDE, READMEs, SERVER_CONFIG/INSTALL storage dirs, RELEASING fixes"
status: merged
milestone: M5
branch: task/T-0471-docs-catch-up
model: auto
effort: low
depends_on: [T-0469]
estimate: 0.4 day
---

# T-0471: docs catch-up

## Spec (written by Claude, do not edit)

### Why
The release audit `docs/audit/release-readiness.md` (T-0469) found stale READMEs and docs, and listed the fixes in §4, items 1-8. This task applies those fixes. **Docs only: no code, config or package changes.**

### Verified facts (do not re-derive)
- **The fix list** is `docs/audit/release-readiness.md` §4, items 1-8. The evidence for each is in §2 (2a: ready `FEATURES.md` rows; 2b: undocumented env vars; 2c: the storage dir) and §3.
- **The latest release tag is `v0.1.13`** (2026-10-03), not `v0.1.9`.
- **Status marks in `docs/FEATURES.md`:** ✅ Live, 🟡 Merged and 🧭 Planned (lines 5-9). The history table is at the end of the file.
- **Features merged on 2026-10-06 and 2026-10-07** include:
  - AI memory (T-0433 to T-0451, web and mobile);
  - the "Remembered: <fact>" line (T-0455);
  - forwarding and multi-select;
  - the media, files and links panel (T-0410, T-0431);
  - files served only to chat members through `/api/files` (T-0453, T-0454; the Caddy cutover is still pending);
  - chat backgrounds (T-0457 to T-0466: presets, own images with dim, a group background set by admins; web and server, mobile pending).
  
  `work/BOARD.md` has the merged rows with dates and summaries.
- **Not built:** the listener and delegation are planned only (`docs/audit/listener-delegation-plan.md`), with one schema task (T-0470) in progress. List them as 🧭 Planned if at all.

### What to change
Apply items 1-8 of `docs/audit/release-readiness.md` §4:
1. **`docs/SERVER_CONFIG.md`:** document `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR`, in the file's existing format. **`docs/INSTALL_DOCKER.md`:** in the storage table and the backup section, say the wallpapers live under the avatar volume (`/data/avatars/backgrounds`) and ride `avatars.tgz`.
2. **`docs/FEATURES.md`:** paste the §2a rows into their sections and add a 2026-10-06 to 2026-10-07 history row. Also add the 2026-10-05 gaps listed in §2a, if the audit lists them. Mark the honest status: 🟡 Merged unless the board says live, and give mobile-pending features a "web, server" location.
3. **`docs/USER_GUIDE.md`:** add short sections for backgrounds, AI memory, forwarding and multi-select, the media and files panel, blocking, and folders, matching the guide's tone. **No new screenshots** (say "screenshot to come" if the guide does that elsewhere; otherwise just text). Fix the three wrong "(coming)" or "still planned" lines the audit cites.
4. **`README.md`:** add the same features to "What it does", and update the M5 status paragraph.
5. **`apps/mobile/README.md`:** replace the stale "mock-data chat shell from T-0019" paragraph with the current mobile feature set (from `docs/FEATURES.md`).
6. **`packages/runner-tunnel/README.md`:** move the M3 remarks to past tense.
7. **`docs/INSTALL_DOCKER.md`:** fix the storage table's Voice row (the audit cites line 362).
8. **`docs/RELEASING.md`:**
   - correct §5's backup claim (line 39);
   - reconcile §1's tag flow with §9's auto-deploy: one short paragraph saying that auto-deploy ships green `main`, and tags are for mobile builds and named releases;
   - state clearly that a migration deploy takes no extra backup, so run `./zilar backup` before merging a destructive migration (line 134).

Every factual statement you add must match the code or the board. When unsure, leave it out and list it in the Report.

### Read first
`AGENTS.md`, `docs/audit/release-readiness.md` (all), `docs/FEATURES.md`, `docs/USER_GUIDE.md`, `README.md`, `apps/mobile/README.md`, `packages/runner-tunnel/README.md`, `docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md`, `docs/RELEASING.md`, `work/BOARD.md` (the merged rows from 2026-10-05 on).

### Allowed files
`docs/FEATURES.md`, `docs/USER_GUIDE.md`, `README.md`, `apps/mobile/README.md`, `packages/runner-tunnel/README.md`, `docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md`, `docs/RELEASING.md`, `work/T-0471-docs-catch-up.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Items 1-8 of the audit's §4 are applied.
- Every feature merged up to 2026-10-07 is in `FEATURES.md` with an honest status.
- The storage dirs are documented.
- `RELEASING.md` no longer contradicts itself.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Docs only. Items 1-8 of `docs/audit/release-readiness.md` §4 applied. No code,
config or package change.

**Files changed** (all inside Allowed files): `docs/SERVER_CONFIG.md`,
`docs/INSTALL_DOCKER.md`, `docs/FEATURES.md`, `docs/USER_GUIDE.md`, `README.md`,
`apps/mobile/README.md`, `packages/runner-tunnel/README.md`, `docs/RELEASING.md`,
`work/T-0471-docs-catch-up.md`.

**What I did, item by item:**

1. `SERVER_CONFIG.md`: new "Avatars and chat backgrounds (T-0165, T-0460)"
   section documenting `AVATAR_STORAGE_DIR` (default `./data/avatars`,
   `config.ts:72`) and `BACKGROUND_STORAGE_DIR` (default `./data/backgrounds`,
   `config.ts:77`), and Avatars / Background wallpapers rows in the "File
   storage, backups, quotas, disk" table. `INSTALL_DOCKER.md`: the storage table
   now has a Background wallpapers row (`BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds`,
   no separate volume), the Avatars row says `avatars.tgz`, and the backup
   paragraph says the avatars archive holds the wallpapers under
   `/data/avatars/backgrounds`.
2. `FEATURES.md`: pasted the §2a rows (Media gallery, Forwarding and
   multi-select, Chat backgrounds, Uploaded files behind membership in section 1;
   AI memory in section 3) and the §2a 2026-10-05 gaps (Blocking people, Chat
   folders, @mention picker on mobile in section 1; Mobile bottom bar, Mobile
   Settings hub redesign in section 7). Added the 2026-10-06 to 2026-10-07
   timeline row. Status is honestly 🟡 Merged everywhere (the board has no live
   click-through); chat backgrounds are "server, web" and the membership row
   "server, web" (mobile still loads the direct `/upload` URL).
3. `USER_GUIDE.md`: added sections for forwarding and multi-select, media/files/
   links, AI memory, blocking, chat folders and chat backgrounds, in the guide's
   tone and with no new screenshots (the guide has no "screenshot to come"
   convention, so the new sections are text only). Fixed the three cited lines:
   the production-push "still planned" line (now merged, T-0145), the
   "(coming) Voice messages" line and the "(coming) GIFs on the phone" line
   (both removed from Coming next).
4. `README.md`: six new rows in "What it does" (AI memory, media/files/links,
   forwarding and multi-select, chat backgrounds, chat folders, blocking) and
   the M5 status paragraph updated with the same features.
5. `apps/mobile/README.md`: replaced the T-0019 mock-shell paragraph with the
   current feature set (real data, AI surface, settings, stickers, Explore,
   contacts, blocking, folders, media sheet, forwarding, mentions) and fixed the
   stale `mock/` layout comment.
6. `packages/runner-tunnel/README.md`: the spike/M3 line and the in-memory key
   registry line now read in the past tense (the platform hub backs the
   registry with Postgres). See the deviation about the preview line below.
7. `INSTALL_DOCKER.md`: Voice storage row was "Not built | Planned"; it now
   says voice recordings upload through XEP-0363 and are stored as normal
   attachments.
8. `RELEASING.md`: §5's backup claim now says the scheduled `./zilar backup`
   covers both databases and the uploads/stickers/avatars volumes (wallpapers
   inside avatars); added the §1 paragraph reconciling tags with §9 auto-deploy
   (green `main` ships, tags are for named releases and the mobile builds); §9
   now says a migration deploy takes no extra backup and to run
   `./zilar backup` before merging a destructive migration.

**Commands and results:**

- `pnpm install` → clean (peer-dependency warning only, pre-existing).
- `pnpm exec prettier --write` on the nine changed files → no changes; the two
  package READMEs are the only changed files Prettier covers (`docs/`, root
  `README.md` and `work/` are in `.prettierignore`).
- `pnpm gate` → `9 changed file(s)`, PASS install / format / lint / typecheck,
  PASS tests `@zilar/mobile`, PASS tests `@zilar/runner-tunnel`,
  `scope: every changed file is inside the Allowed files`, **GATE PASS**.
- I ran no single test file: the task touches docs only, so the only tests were
  the two packages of the touched READMEs, run by the gate.

**Deviations from the spec (all in Allowed files, all to keep the docs honest):**

- The audit said to move all M3 remarks in `runner-tunnel/README.md` to past
  tense. I moved the spike and key-registry remarks to the past tense, but left
  "room-member authorization on previews" as still open: `work/BOARD.md:27`
  lists "preview-token expiry and room-member authorization" under open M3
  hardening, and `packages/runner-tunnel/src/server.ts:196-197` still says so.
  I reworded it to point at the board instead of claiming it shipped.
- The audit's ready timeline row listed "blocking and chat folders" under
  2026-10-06 to 2026-10-07, but the board dates those 2026-10-05. I kept them
  out of the new row and added them to the existing 2026-10-04 to 2026-10-05
  row instead.
- I also corrected two stale statements the audit did not cite but that would
  contradict the corrected text: `SERVER_CONFIG.md`'s storage table had the
  same "Voice | Not built" row as `INSTALL_DOCKER.md` (fixed), and
  `INSTALL_DOCKER.md` said "both file volumes" (there are three: uploads,
  stickers, avatars). I also fixed `USER_GUIDE.md:140` ("Sending GIFs from the
  phone app is still being built" → the phone has the GIFs tab, T-0148).
- The audit's `SERVER_CONFIG.md` line references were off by a few lines; I
  cited `config.ts:72`/`:77` and `deploy/docker-compose.yml:148`/`:153` directly
  from the files.

**Open questions / not done:**

- The spec's item 9 (bump the mobile app version / add `versionCode` /
  `buildNumber`) and item 10 (the upload-lock cutover, including the mobile
  minimum-version announcement) are decisions for Julio and are out of this
  task; not touched.
- The audit also flagged stale `apps/server/.env.example` / `deploy/.env.example`
  gaps for the new env vars. Those files are not in the Allowed files, so I did
  not change them.

## Review (written by Claude)

Approved (lead, 2026-10-07). Audit section 4, items 1-8, applied:
- the storage dirs are documented (SERVER_CONFIG, INSTALL_DOCKER: wallpapers ride avatars.tgz);
- FEATURES rows and the 10-06/07 history are added;
- USER_GUIDE sections are added and the stale lines fixed;
- the README, mobile README and runner-tunnel README are updated;
- RELEASING reconciles tags with auto-deploy and says to back up before a destructive migration.
Follow-up: add the two storage vars to the .env examples (a small task).
