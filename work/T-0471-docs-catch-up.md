---
id: T-0471
title: "Docs catch-up from the release audit: FEATURES, USER_GUIDE, READMEs, SERVER_CONFIG/INSTALL storage dirs, RELEASING fixes"
status: todo
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

## Review (written by Claude)
