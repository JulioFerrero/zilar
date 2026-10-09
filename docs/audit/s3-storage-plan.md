# S3 storage plan: off-host backups and app files (T-0747)

Docs only. No code, config or schema changes. Line numbers are from the worktree
`/Users/julio/personal-projects/zilar-T-0747` on branch `task/T-0747-s3-storage-audit`
on 2026-10-09. Task: `work/T-0747-s3-storage-audit.md`.

Sources: repo files (`path:line`), the local `ghcr.io/processone/ejabberd:26.07`
image (inspected read-only), web pages fetched on 2026-10-09 (listed at the end),
and the Coolify MCP tool schemas. Anything not checked is marked **unverified**.

## Summary

1. **Off-host backups are a configuration task, not a code task.** Coolify can
   dump both Postgres databases to S3 on a schedule and can back up the file
   volumes to S3 too. Julio must create a bucket and a scoped key first.
2. **ejabberd cannot store uploads on S3 out of the box.** The 26.07 image has
   only the local-disk `mod_http_upload`. An S3 module exists in ejabberd-contrib
   (`mod_s3_upload`) but is not in the image, and its default makes downloads
   public. Using it needs a spike first.
3. **Stickers, avatars and backgrounds can move to S3 without changing their URLs.**
   All reads and writes go through three small service files that take a
   directory today. A storage interface with a disk and an S3 backend fits there.
4. **Chat uploads already read through the server.** `GET /api/files` (T-0454)
   checks membership and streams the bytes from ejabberd. Only the write side and
   the storage location are still ejabberd's.
5. **Two docs disagree.** `docs/RELEASING.md:41` says the scheduled backup covers
   the file volumes. `deploy/coolify/scheduled-backup.md:45-67` says it does not.
   The Coolify file is the one that applies to this install.

---

## 1. Inventory: who writes and reads each file

| Store | Writer (file:line) | Reader and route | URL shape | Cleanup | DB rows? | Volume |
| --- | --- | --- | --- | --- | --- | --- |
| Stickers | `stickers/service.ts:903` (`uploadSticker`, key set at `:862`); `:1363` (Telegram import) | `readStickerFile` `:977-1003`; routes `stickers/api.ts:363`, `:389`; `Cache-Control: public` at `:804` | `/api/stickers/<id>/file` (`stickers/service.ts:211`) | `rm` at `:515` (pack delete), `:960` (sticker delete) | yes: `stickers.storage_key` (`db/schema.ts:846`, key at `:859`) | `sticker-data` |
| Avatars | `avatars/service.ts:208` (`uploadAvatar` `:190`, key at `:204`) | `readAvatarFile` `:334-360`; routes `avatars/api.ts:71`, `:84`; `Cache-Control: private` at `:202` | `/api/avatars/<id>` (`avatars/service.ts:44-46`) | `rm` at `:245`, `:254` (replace), `:311` (delete) | yes: `avatars.storage_key` (`db/schema.ts:898`, key at `:908`) | `avatar-data` |
| Chat backgrounds | `backgrounds/service.ts:172` (`uploadBackground` `:142`, key at `:153`) | `readBackgroundFile` `:233-272`; routes `backgrounds/api.ts:146`, `:165`; `private` at `:252` | `/api/backgrounds/<id>` (`backgrounds/service.ts:57-59`) | `rm` at `:186` (failed upload), `:339` (delete) | yes: `chatBackgrounds.storage_key` (`db/schema.ts:687`, key at `:698`) | `avatar-data` (sub-dir) |
| Chat uploads | ejabberd `mod_http_upload` PUT into `docroot: /opt/ejabberd/upload` (`deploy/ejabberd/ejabberd.yml:233-236`, `put_url` `:236`) | ejabberd GET at `/upload` (`ejabberd.yml:96`); web routes same-origin `/upload/` through `GET /api/files` (`apps/web/src/lib/attachments.ts:85-108`); server fetches via `files/api.ts:161`, `:202`, `:279-282` and `voice-transcription/routes.ts:152-174` | `https://<domain>/upload/<slot>/<file>` | ejabberd quotas delete the oldest files past the hard quota (`ejabberd.yml:194-197`, `:251`); nothing else deletes (per `upload-auth-plan.md` §4, not re-checked) | no bytes row; `media_items` stores the URL (`db/schema.ts:1390`) | `ejabberd-uploads` (server does not mount it: compose `:212-213`) |

Facts that matter for the plan:

- **Disk only:** all four stores keep the bytes on disk. The DB holds the key (stickers, avatars, backgrounds) or only the URL (chat uploads).
- **Keys are `<uuid>.<ext>`:** each file is named by a server-made id (`stickers/service.ts:862`, `avatars/service.ts:204`, `backgrounds/service.ts:153`). A key is never user input, so it maps 1:1 to an S3 object key.
- **Config defaults differ from production:** `config.ts:154` defaults `BACKGROUND_STORAGE_DIR` to `./data/backgrounds`, while `deploy/coolify/docker-compose.yml:149` sets `/data/avatars/backgrounds`. Production is correct; the default is only for local runs.
- **Write-then-row order:** stickers and avatars write the file and roll back the row on failure (`stickers/service.ts` around `:903-915`, `avatars/service.ts:207-254`). A copy to S3 must keep the same order.

---

## 2. Part A: off-host backups (no code)

### 2.1 What exists today

| Piece | Where | What it covers |
| --- | --- | --- |
| Plain-stack archive | `deploy/zilar` `cmd_backup` `:865`; dumps `:952-955`; globals `:959-960`; tars uploads, stickers, avatars `:965-969`; archive list `:991` | Both DBs, all three file stores, and `.env` (live secrets). Needs a host checkout. |
| Coolify DB schedule | `deploy/coolify/scheduled-backup.md:19-41` | Both DBs (`zilar`, `ejabberd`) via the `postgres` component; daily 03:30; keep 7; S3 optional (`:43`). |
| Coolify file stores | `scheduled-backup.md:45-67` | **Not covered** by the DB schedule. The doc asks for a volume backup of your own. |
| Host cron example | `deploy/backup-cron.example:19` | Runs `deploy/zilar backup`. Plain stack only. |

`deploy/zilar` is the plain-stack helper. Coolify has no checkout on the host
(`scheduled-backup.md:9-11`), so the helper cannot run on this install.

### 2.2 Coolify facts (sources at the end)

- **S3 storage entry:** Coolify asks for a name, the bucket, region, access key and
  secret key. The endpoint is split into protocol, host, port and path. It is
  validated with "Validate Connection & Continue" before a backup can use it.
  (Coolify S3 docs.)
- **Database backups inside a Service are supported.** Coolify reads the
  credentials from the container's environment: `POSTGRES_PASSWORD` and
  `POSTGRES_USER`, which `deploy/coolify/docker-compose.yml:39-40` already sets.
  (Coolify backups docs.)
- **S3 for database backups:** enable S3 on the schedule and pick the validated
  storage. Coolify uploads the local dump after the dump succeeds. S3 retention
  is separate from the local retention. (Coolify backups docs.)
- **Volume backups:** the Coolify MCP `storages` tool schema has `backup_set`
  with `frequency` (cron), `s3_storage_uuid`, `save_s3`, `retention_amount_s3`,
  `retention_days_s3`, `retention_max_storage_s3`, `disable_local_backup`, and
  `stop_during_backup` (its description: "Downtime: stops the container"). It is
  for Coolify 4.2 or later. The description says `backup_set` **replaces** the whole
  schedule and that there is **no read-back endpoint**, so always send the full
  object.
- **Database schedule fields:** the MCP `database_backups` schema has
  `databases_to_backup`, `dump_all`, `save_s3`, `s3_storage_uuid`, and
  `database_backup_retention_*_s3`.
- **Immediate backups:** `docs/RELEASING.md:136` says a database inside a service
  has no "backup now" endpoint. The only immediate backup is a storage-volume
  backup, which is not an engine-aware dump.

### 2.3 Steps for Julio and the lead

1. **Julio creates the bucket(s) and a key.** Use one bucket for database dumps and
   one for file volumes, or two prefixes in one bucket. Scope each key to its
   bucket. Julio enters the values only in Coolify's S3 form, never in the repo.
2. **Add the S3 storage** in Coolify under S3 Storage, and select "Validate Connection
   & Continue". Names only in notes: one entry for dumps, one for file volumes.
3. **Database schedule:** on the `postgres` component, add a schedule with
   `databases_to_backup` set to `zilar,ejabberd`, frequency `30 3 * * *`, local
   retention 7, and S3 enabled with its own retention. Run "Backup Now" once, then
   check the Executions page: status Success, both names, size above zero.
4. **File volumes:** `backup_set` on each of the four file volumes
   (`ejabberd-uploads`, `sticker-data`, `avatar-data`; `postgres-data` is covered by
   the dumps and should not be copied while Postgres runs). Set `save_s3: true`,
   `s3_storage_uuid`, a cron, and retention. Decide `stop_during_backup` per volume:
   `true` gives a consistent copy but stops the container (the server or ejabberd
   goes down for the copy); `false` may copy a file that is being written.
   **Unverified:** how long a copy takes on this data size (no size figures in the repo).
5. **Restore drill** (see 2.4) before calling it done.

### 2.4 Restore drill

1. Download the newest `zilar` and `ejabberd` dumps from S3.
2. Restore both into a throwaway Postgres (a local disposable container, never the
   live one). The plain-stack helper's restore flow is at `deploy/zilar` around
   `:1123`; the Coolify restore steps are **unverified** here (the Coolify restore
   guide was not fetched).
3. Restore the newest `avatar-data` and `sticker-data` volume copies into a scratch
   volume. Count the files.
4. Check that every `stickers.storage_key`, `avatars.storage_key` and
   `chatBackgrounds.storage_key` has a file, and that the counts match the rows.
   Missing files mean the backup is not usable.
5. Write the result (counts, ids only, no keys) in the drill's Report.

### 2.5 Provider comparison

| Option | S3 API | Storage price | Egress | Notes |
| --- | --- | --- | --- | --- |
| Hetzner Object Storage | Yes (page says S3-compatible) | **Unverified:** the fetched page did not render the base price | 1 TB per month included with the base price; extra is per TB (**rate unverified**) | Billed per hour per account, not per bucket |
| Cloudflare R2 | Not checked in this audit | $0.015 per GB-month | Free (page: "free") | Class A $4.50 per million, Class B $0.36 per million; free tier 10 GB-month |
| Backblaze B2 | Not checked in this audit | $6.95 per TB-month (about $0.00695 per GB) | Free up to 3x average stored; then $0.01 per GB | No minimum storage duration |
| MinIO or Garage on this host | Yes | Disk cost only | None | **Same host gives no off-host protection.** Useful for a local copy, not as the backup |

Only the same-host row is a sure "no": a store on the same machine dies with the
machine. The others are off-host, so a bucket is the right place for the nightly copy.

---

## 3. Part B: app files on S3

### 3.1 Server files (stickers, avatars, backgrounds)

**Today's shape.** Each module takes a `storageDir` and calls `fs` directly:

- writes: `stickers/service.ts:903`, `:1363`; `avatars/service.ts:208`; `backgrounds/service.ts:172`;
- reads: `stickers/service.ts:1003`; `avatars/service.ts:360`; `backgrounds/service.ts:272`;
- deletes: `stickers/service.ts:515`, `:960`; `avatars/service.ts:245`, `:254`, `:311`; `backgrounds/service.ts:186`, `:339`.

The dir comes from `STICKER_STORAGE_DIR`, `AVATAR_STORAGE_DIR` and
`BACKGROUND_STORAGE_DIR` (`config.ts:144`, `:149`, `:154`), checked at startup
(`index.ts:102-117`) and wired in `app.ts:426`, `:444`, `:457`.

**Effect status.** The project uses Effect 4.0.2 (`apps/server/package.json`
lines 15-26; installed `effect` is 4.0.2). The installed packages have no S3 module
(searched `effect/dist` and `@effect/platform-node/dist` for `S3`). The AWS SDK is
not in `pnpm-lock.yaml`. So an S3 backend means a new dependency (for example
`@aws-sdk/client-s3`). AGENTS.md says a new dependency needs to be listed in the
spec, so Julio must approve it.

**Plan:**

- A storage interface with `put`, `get` (stream), `delete` and `exists`, plus two
  backends: disk (today's behaviour) and S3. Keys are the existing `storage_key`
  values, so no DB change.
- Keep the URLs the same (`/api/avatars/<id>` and the rest). Only the route handler
  changes: it reads from the backend and streams the bytes. Old clients need no change.
- **Presigned URLs versus streaming.** A presigned GET (a redirect from the route)
  takes bytes off the server, but the image then works for anyone holding the URL
  until it expires. Streaming keeps the session check on every load, but the server
  pays the egress. Avatars and backgrounds are `private` today (`avatars/api.ts:202`,
  `backgrounds/api.ts:252`); stickers are `public` (`stickers/api.ts:804`). A presigned
  redirect would have to keep `private` for avatars and backgrounds, and that
  redirect cannot be cached by shared caches. **Recommendation:** stream first; use
  presigned redirects only for stickers, after Julio confirms sticker packs are
  meant to be public (**unverified** what "server" visibility means for packs).
- **Migration:** copy each volume's files to the bucket under the same keys. A
  one-off script, run once with the server stopped, plus a count check against the
  rows. Julio must approve the live run.
- **Tests:** unit tests against an in-process S3 fake (no real service, no real
  keys), and the existing route tests with a temp dir for the disk backend.

### 3.2 Chat uploads (ejabberd)

**Question:** can ejabberd's upload store go to S3?

**Stock 26.07 (verified in the image):**

- The image is `ghcr.io/processone/ejabberd:26.07`, which holds ejabberd 26.7.0
  (`/opt/ejabberd-26.07/lib/ejabberd-26.7.0/`) with xmpp 1.13.4. Our
  `deploy/ejabberd/Dockerfile:19` uses this base image.
- `mod_http_upload.beam` has no S3, AWS, bucket, minio, amazon or sigv4 names
  (case-sensitive grep). There is no `mod_s3_upload` beam in the image.
- The options that are present are `docroot`, `put_url`, `get_url`, `dir_mode`,
  `file_mode`, `rm_on_unregister`, `thumbnail`, `custom_headers`, `max_size`,
  `access`, `jid_in_url`, `external_secret`, `service_url`.
- ejabberd's docs list the same options and say none of them points to S3 or
  another remote store. `docroot` is a local directory. (docs.ejabberd.im, fetched.)
- `external_secret` "makes it possible to offload all HTTP Upload processing to a
  separate HTTP server" (docs.ejabberd.im). The docs do not describe that server's
  protocol, so it is **unverified** as a path to S3.

**ejabberd-contrib `mod_s3_upload` (fetched from GitHub):**

- Implements XEP-0363 with S3-compatible storage. The server issues a signed PUT URL
  with a TTL (`put_ttl`, default 600 s); the client PUTs the bytes straight to the bucket.
- Options: `access_key_id`, `access_key_secret`, `region`, `bucket_url` (all required),
  `max_size` (default 1 GiB), `put_ttl`, `set_public` (default **true**),
  `service_name`, `access`, `hosts`.
- `set_public: true` by default means the stored objects are public. That conflicts
  with the decision Julio made on 2026-10-07 to lock files behind the session and
  membership (`docs/audit/upload-auth-plan.md` §7). The README says nothing about
  download access control.
- Needs Erlang/OTP 25 or later. No supported ejabberd version is stated.
- **Unverified:** whether `set_public: false` works with the chat download path, and
  whether `mod_http_upload_quota` (which counts files under `docroot`,
  `ejabberd.yml:187-193`) still works with it. Both need a spike.
- It is not in the image. Using it means building a new image with the module
  installed and the config added. The module install path inside the container is
  **unverified**.

**Verdict:** ejabberd can store uploads on S3 only through a contrib module that is
not in the image, whose default makes downloads public, and whose quota behaviour is
unknown. It is a spike, not a drop-in.

**Alternatives:**

| Option | What changes | Pros | Cons |
| --- | --- | --- | --- |
| A. Keep uploads on disk, back up the volume to S3 (Part A) | Nothing in code | Simple; covers the risk of losing data | Not S3 storage; the disk is still the only copy |
| B. `mod_s3_upload` in a custom ejabberd image | Image build, `ejabberd.yml`, config keys, `files/api.ts` read path | Native XEP-0363 with S3 | Public downloads by default; quota and deletion unknown; contrib maintenance unknown |
| C. Zilar server issues the XEP-0363 slots and stores to S3 | Clients' slot request path (`packages/xmpp-core/src/client.ts:1049-1081`, per `upload-auth-plan.md` §1a, not re-checked here), a new upload endpoint, `files/api.ts` read path | Membership checked at write and read; no public bucket; reuses `upload-auth-plan` option (a) | Largest change; client work on web and mobile; ejabberd still needs the slot protocol turned off or redirected |

**Recommendation:** A now (Part A covers it). Then a spike of B (one day, in a
throwaway container, checking `set_public`, the quota module and the GET path).
Choose C only if B fails the access check. Julio decides, because B makes downloads
public by default.

---

## 4. Risks

| Risk | Where it bites | Mitigation |
| --- | --- | --- |
| Same-host backups | Plain copies on this machine | Off-host bucket (Part A) |
| Archives hold live secrets | `deploy/zilar:971` copies `.env` into the archive; `:973-977` warns | Encrypt before any copy; restrict bucket access; separate key per bucket |
| Public downloads | Contrib `mod_s3_upload` default (`set_public: true`) | Spike with `set_public: false`; do not enable without Julio's OK |
| Quota deletes files | `ejabberd.yml:194-197`: oldest files go past the hard quota | Decide whether a volume copy can run during quota trims |
| Partial copies | `stop_during_backup: false` while writes happen | Stop the container for the copy, or accept the risk and test the drill |
| Orphaned files on a path change | `config.ts:144-154` comments and `deploy/coolify/docker-compose.yml:137-148` say a manual path change orphans files | Migrate by key, never by path |
| Egress cost | Streaming all avatars and stickers through the server | Measure first; presigned redirects only where the policy allows |
| Restore never tested | `scheduled-backup.md:77-81` | The drill in 2.4 is a required task |
| Doc contradiction | `docs/RELEASING.md:41` vs `scheduled-backup.md:45-67` | Fix in the docs task (A4) |

---

## 5. Ordered task list

Sizes are rough. "Julio" marks a task that needs his secrets, live config, data
migration or a decision.

| # | Task | Files | Tests | Size | Depends on | Julio |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Create the buckets and scoped keys; add the two S3 storages in Coolify | none (Coolify UI) | Validate Connection succeeds | 0.5 h | none | **yes**: secrets and live config |
| A2 | Database schedule with S3 on (`zilar`, `ejabberd`); first run checked | none (Coolify UI or `database_backups`) | Backup Now; Executions show both DBs | 0.5 h | A1 | **yes**: live config |
| A3 | Volume backups for the three file volumes (`ejabberd-uploads`, `sticker-data`, `avatar-data`) with `backup_set` | none (Coolify MCP `storages`) | `backup_run` once; list the archives in the bucket | 1 h | A1 | **yes**: live config, stop-or-not decision |
| A4 | Fix the docs contradiction and write the runbook: `docs/RELEASING.md:41`, `scheduled-backup.md` | `docs/RELEASING.md`, `deploy/coolify/scheduled-backup.md` | `pnpm gate` (docs) | 1 h | A2, A3 | no |
| A5 | Restore drill, counts recorded | runbook only | drill steps in 2.4 | 2 h | A2, A3 | **yes**: runs on a disposable DB |
| B1 | Storage interface with a disk backend; no behaviour change | `apps/server/src/storage/` (new), `apps/server/src/config.ts` | Vitest on the disk backend | 0.5 day | none | no |
| B2 | S3 backend with a local fake; dependency decision first | `apps/server/src/storage/` (new), `apps/server/package.json` | Vitest with the S3 fake | 1 day | B1 | **yes**: approve the new dependency |
| B3 | Port avatars to the interface (`avatars/service.ts` lines 208, 245, 254, 311, 360) | `apps/server/src/avatars/service.ts`, `avatars/api.ts`, tests | existing avatar tests with a temp dir | 0.5 day | B1 | no |
| B4 | Port backgrounds (`backgrounds/service.ts` 172, 186, 272, 339) | `apps/server/src/backgrounds/service.ts`, `backgrounds/api.ts`, tests | existing background tests | 0.5 day | B1 | no |
| B5 | Port stickers (`stickers/service.ts` 515, 903, 960, 1003, 1363) | `apps/server/src/stickers/service.ts`, `stickers/api.ts`, tests | existing sticker tests | 1 day | B1 | no |
| B6 | Migration script: copy each file store to the bucket by `storage_key`, count check | `apps/server/scripts/` (new) | dry run on a copy of the rows | 0.5 day | B2, B3-B5 | **yes**: live data migration |
| B7 | Spike: `mod_s3_upload` in a throwaway ejabberd container (`set_public`, quota, GET path) | `deploy/ejabberd/` only in a scratch branch | manual; written result | 1 day | none | **yes**: decides public downloads |
| B8 | Chat uploads: option B (image + config) or option C (server slots), per B7 | `deploy/ejabberd/Dockerfile`, `deploy/ejabberd/ejabberd.yml`, `apps/server/src/files/api.ts` (and client code for C) | Vitest for the route; gate | 2-5 days | B7 | **yes**: decision and live migration of `ejabberd-uploads` |

Order: A1 to A5 can run now and need no code. B1 can run in parallel. B7 is the
gate for B8. B6 runs only after B2 to B5 and Julio's go-ahead.

---

## 6. Unverified items

- Hetzner Object Storage price per TB and the overage rate (the page did not render them).
- R2 and B2 S3 API compatibility (not checked here; both are widely used S3 APIs).
- Coolify's exact UI steps and restore guide for this version; the saved Coolify storage list (volume names) was taken from the task spec, not re-listed.
- Whether `mod_s3_upload` works on ejabberd 26.07 and with `set_public: false`.
- How contrib modules install inside a container.
- Size of the data on each volume (no figures in the repo).
- The Garage cookbook page on ejabberd (only a search snippet was seen; the page returned 404).

## Sources

- ejabberd modules docs, mod_http_upload section: https://docs.ejabberd.im/admin/configuration/modules/ (fetched 2026-10-09)
- ejabberd-contrib `mod_s3_upload`: https://github.com/processone/ejabberd-contrib/tree/master/mod_s3_upload (fetched 2026-10-09)
- Coolify, S3 storage: https://coolify.io/docs/knowledge-base/s3/introduction (fetched 2026-10-09)
- Coolify, database backups: https://coolify.io/docs/databases/backups (fetched 2026-10-09)
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/ (fetched 2026-10-09)
- Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing (fetched 2026-10-09)
- Hetzner Object Storage: https://www.hetzner.com/storage/object-storage/ (fetched 2026-10-09; price not rendered)
- ejabberd 26.07 image, read-only inspection of `/opt/ejabberd-26.07/lib/ejabberd-26.7.0/ebin/` (`docker run --rm --network none`, no daemon)
- Coolify MCP tool schemas `storages` and `database_backups` (local tool descriptions, 2026-10-09)
