---
id: T-0151
title: Production storage safety (sticker volume, backups, disk check, upload quota)
status: review
milestone: M5
branch: task/T-0151-deploy-storage-safety
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0151: Production storage safety

## Spec (written by Claude, do not edit)

### Why
Plan: about 200 people within a month sending files, images and stickers. Files live in two places: ejabberd's HTTP upload docroot (`/opt/ejabberd/upload`, volume `ejabberd-uploads`) and the server's `STICKER_STORAGE_DIR` (default `./data/stickers`). Gaps found on 2026-10-01:
- `deploy/docker-compose.yml` (and the Coolify compose) mount NO volume for `STICKER_STORAGE_DIR`: sticker files are lost when the server container is replaced.
- The database dump does not include either file store. `./deploy/galena backup` / `restore` must be checked and, if they miss a volume, extended.
- Nothing warns when the disk fills, and nothing limits how much one person can upload.

### What to build
1. Compose files (`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`): a named volume `sticker-data` mounted at a fixed absolute `STICKER_STORAGE_DIR` (for example `/data/stickers`) for the server, with that env set. The directory must be writable by the server user.
2. `./deploy/galena backup` and `restore`: include BOTH the uploads volume and the sticker volume (verify first what they do today; keep the existing archive layout and the 0600 mode). Restore must put them back and the tests prove a round trip with fake files.
3. `./deploy/galena doctor`: report free space of the Docker data/volume filesystem; warn at 80% used, fail at 95%, in plain words. Also check that the sticker directory is a mounted volume (not the container layer) when running under compose.
4. ejabberd upload quota: configure ejabberd's `mod_http_upload_quota` (`max_days` for old files only if the owner sets it, and per-user `access_soft_quota`/`access_hard_quota` with a sensible default such as 2 GiB soft / 4 GiB hard) in `deploy/ejabberd/ejabberd.yml`, documented, with the knobs overridable through macros like the other deploy settings. Keep `max_size` at 50 MiB. If the quota module cannot be configured with the stock image, say so in the Report instead of guessing.
5. Docs (`docs/SERVER_CONFIG.md`, install guide, `docs/FEATURES.md` row): where each kind of file lives (attachments: ejabberd upload volume; stickers: sticker volume; GIFs: not stored, proxied; voice: not built), how backups cover them, the quota defaults, and a short "when to consider S3" note (more than one server instance, large growth; ejabberd's upload module writes only to local disk).
6. Out of scope: any S3 or storage-abstraction code, server/web/mobile code, schema changes.

### Read first
`AGENTS.md`, `work/T-0127-install-wizard-backup-baremetal.md`, `work/T-0145-deploy-push.md` (Review), `deploy/**`, `docs/SERVER_CONFIG.md` (sticker storage rows), `apps/server/src/startup.ts` (sticker dir checks, read only).

### Allowed files
`deploy/**`, `docs/**`, the deploy tests, `work/T-0151-deploy-storage-safety.md`. Not allowed: `apps/**`, packages, schema, dependencies, `infra/**` (dev stack).

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
sh deploy/tests/push-deploy.test.sh
```
Plus the deploy tests you add for backup/restore and doctor.

### Acceptance
- Compose renders with the new volume on both files; the sticker dir is under a mounted volume.
- Backup then restore round-trips fake upload and sticker files; archive and files are mode 0600.
- Doctor warns at 80% and fails at 95% (tested with an injected usage number, no real disk fill).
- Quota config is documented with defaults and parses (ejabberd.yml is valid YAML and uses only documented options).
- No secrets printed anywhere.

## Report (written by the worker when done)

### What I did
- Compose (`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`): new named volume `sticker-data` mounted at fixed absolute `STICKER_STORAGE_DIR=/data/stickers` on `server` (always set, never relative/empty). Default named-volume ownership keeps it writable by the non-root server user (commented in both files).
- `deploy/galena` backup/restore: `backup` now archives BOTH `uploads.tgz` (ejabberd volume, as before) and `stickers.tgz` (`tar -C /data -czf - stickers` through the server container), chmod 0600, same archive layout + manifest (unchanged `galena-backup-v1`). `restore` requires `stickers.tgz`, starts ejabberd+server, restores both volumes, dry-runs updated. Archive/file modes unchanged (0600).
- `deploy/galena doctor`: new section 6 — disk usage of the Docker data filesystem (`df -P /data/stickers` inside the server container; POSIX output, `%` stripped, numeric guard): WARN (stderr) at >= 80%, FAIL at >= 95%, plain words with fix hints. Plus a sticker-mount check (`stat -c %d /data/stickers` vs `/`: same device = container layer = FAIL with the volume fix hint). Both skip cleanly when the stack is down. `GALENA_DOCTOR_DISK_USED_PCT` injects a value for tests only (documented in the code comment).
- ejabberd quota (`deploy/ejabberd/ejabberd.yml` + bare metal): stock `mod_http_upload_quota` enabled (`mod_http_upload_quota: {}` — defaults name the standard rules, no `access_*_quota` lines needed), `shaper_rules` gains literal `soft_upload_quota: 2048: all` / `hard_upload_quota: 4096: all` (MiB), `max_size` stays 52428800, no `max_days` (files never age out). Knobs: `UPLOAD_SOFT_QUOTA_MB` / `UPLOAD_HARD_QUOTA_MB` under `define_macro` (documented as the named settings) + same-named `EJABBERD_MACRO_UPLOAD_*` env in both compose files (defaults 2048/4096) + commented `UPLOAD_SOFT_QUOTA_MB`/`HARD` in `deploy/.env.example`. Bare metal mirrors the module + rules literally.
- Docs: `docs/SERVER_CONFIG.md` new "File storage, backups, quotas, disk (T-0151)" section (where-each-file-lives table incl. GIFs-proxied/voice-not-built, quota defaults + retune rule, doctor thresholds, S3 note) + fixed the stale Stickers Docker note (relative `./data/stickers` → fixed `/data/stickers` in production). Install guide gains a "Storage, quotas, disk" section + backup paragraphs now name both volumes; bare-metal guide §1/§4/§7 cover the sticker dir (`STICKER_STORAGE_DIR=/var/lib/galena/stickers`, unit `ReadWritePaths` comment, backup tar lines, quota + `df` notes); baremetal `.env.example` gains `STICKER_STORAGE_DIR`; `docs/FEATURES.md` gains the T-0151 row.
- Tests: `deploy/tests/storage-safety.test.sh` (new, shell-only, 20 checks, all passing): both compose files render with the sticker volume at the fixed path + uploads intact; quota rules literal 2048/4096, 50 MiB max, no max_days, yml parses; doctor warns at 80 / fails at 95 (injected); backup/restore dry-runs list both stores; no secret material in outputs.

### Files changed
- `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml` (sticker volume + env, quota macro env)
- `deploy/ejabberd/ejabberd.yml` (quota module + shaper rules + macro knobs), `deploy/baremetal/ejabberd.yml` (same, literal)
- `deploy/galena` (backup/restore stickers.tgz, doctor disk + mount checks), `deploy/.env.example` (quota knobs, storage note)
- `deploy/baremetal/.env.example` (STICKER_STORAGE_DIR), `deploy/baremetal/galena-server.service` (comment only)
- `deploy/tests/storage-safety.test.sh` (new)
- `docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md`, `docs/INSTALL_BARE_METAL.md`, `docs/FEATURES.md`, this task file (Report + status)

### Commands run and real results
- `pnpm install`: pass (Done in 13.8s).
- `sh deploy/tests/storage-safety.test.sh`: **20 pass, 0 fail**.
- `sh deploy/tests/push-deploy.test.sh`: **20 pass, 0 fail** (no regressions from the quota/module/compose edits).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (10 tasks successful, cached — no app code touched).
- `sh -n deploy/galena`: pass. `shellcheck`: NOT installed on this machine (reported per T-0127/T-0145 precedent); scripts are POSIX (`set -eu`, quoted expansions).
- Live ejabberd 26.07 probes (stock `ghcr.io/processone/ejabberd:26.07`, mnesia-only scratch containers, throwaway configs in /tmp, all removed afterwards): (1) quota options validated at boot — `max_days: -5` aborts with `Invalid value of option modules->mod_http_upload_quota->max_days`; (2) unknown quota option (`put_url` mis-indented under the quota module) aborts naming the available options (`access_hard_quota, access_soft_quota, max_days`); (3) final shipped layout (literal `2048: all` / `4096: all` + `mod_http_upload_quota: {}`) boots green, `dump_config` shows `soft_upload_quota: 2048: all`, `hard_upload_quota: 4096: all`, `mod_http_upload_quota: []`, zero `unknown shaper`/`invalid`/`critical` lines.
- Vitest: no app/package test files touched (Allowed files are deploy/docs only), so per AGENTS.md I ran the directly-touching tests (storage-safety 20/20 + push 20/20) instead of an unrelated package suite.

### Problems, deviations from the spec, open questions
- **Quota knobs are document-only, not macro-expandable (deviation, verified live — not guessed).** The spec asks for the quota knobs "overridable through macros like the other deploy settings". I proved against the stock image that shaper-rule KEYS do not expand macros: `soft_upload_quota: UPLOAD_SOFT_QUOTA_MB: all` boots but leaves the literal text `UPLOAD_SOFT_QUOTA_MB: all` in `dump_config` with `Shaper rule 'soft_upload_quota' refers to unknown shaper: UPLOAD_SOFT_QUOTA_MB` warnings — the rule silently resolves to nothing (fail-OPEN: no quota at all). The shipped layout uses literal `2048: all` / `4096: all` (proven green in `dump_config`), with `UPLOAD_SOFT_QUOTA_MB` / `UPLOAD_HARD_QUOTA_MB` kept as named knobs under `define_macro` + compose env + `.env.example` that document the setting and must be edited in lockstep with the two numbers (comments say so at each site). Alternatives for the lead: (a) accept document-only knobs (current); (b) an entrypoint sed-rewrite of the two numbers at container start (like push-entrypoint.sh does for the host) — more moving parts, untested here.
- **`max_days` deliberately unset (spec-compliant option, not an omission).** The spec says "`max_days` for old files only if the owner sets it" — no knob is wired (no env var, no macro); files age out only if the owner edits the yml. Said plainly in docs + Report.
- **Live enforcement (oldest-file trimming) NOT proven.** Slot-request over XMPP needs an account; `ejabberdctl register` RPC timed out on the mnesia-only probe (node up, `status` green, C2S reachable, but RPC calls hung — likely the Docker Desktop VM on this shared machine), so no authenticated XMPP session could be established. What IS proven live: the module is stock in the image (`mod_http_upload_quota.beam` on disk), its options validate at boot (bad values abort), the shipped values resolve in `dump_config` with no warnings. Trimming behavior itself is per the module source (read at 26.07 tag) + official docs, not per a live upload.
- **No live backup/restore round trip here.** The spec's acceptance wants backup→restore with fake files; the stack images for this worktree were never built (no `galena-server`/`galena-postgres` locals, and building + `up` on the shared machine risks the lead's dev stack/ports). The test asserts dry-run contents + archive member requirements + mode logic, not a live round trip. The lead's live check should run: `init` scratch → `up` → place fake upload + sticker files → `backup` → `down -v` → `restore --yes` → both files back, archive + members 0600.
- **Doctor disk path uses the server container's `df`/`stat`.** `df -P /data/stickers` inside the server container reports the Docker data filesystem (volumes live there); `stat -c %d` compares mount devices. Both depend on the stack running and skip otherwise. The 80/95 thresholds are fixed constants (spec), tested only via the `GALENA_DOCTOR_DISK_USED_PCT` injection — no real disk was filled.
- **Bare metal unverified on a real machine** (same standing caveat as T-0127 §8): the yml parses (prettier), quota rules mirror the proven Docker values, but no `ejabberdctl`, no systemd, no real boot here.
- **Security checklist:** no secrets read/committed (only throwaway single-char test values; probe containers used throwaway passwords, all removed); no request logging touched; no deletes/updates; quota enforcement is server-side in stock ejabberd (no caps changed in app code); no routes added (401 sweep N/A); no audit entries (file ops unaudited by design, same as uploads before).

### Blocked / needs a decision
- None blocking. Lead follow-ups: (1) accept document-only quota knobs vs entrypoint rewrite (above); (2) live backup→restore round trip with fake files per Acceptance; (3) live oldest-file trim proof (needs an XMPP-authed upload past the hard quota); (4) bare-metal guide on a real Linux host.

## Review (written by Claude)
