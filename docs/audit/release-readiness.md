# Release readiness audit (T-0469)

Audit date: 2026-10-07. Docs only — no code, config or package change.

This answers Julio's three questions with facts from the repository:

1. Are we using Effect 4.0 in all the project?
2. Are the READMEs updated?
3. What can we miss in a release?

Everything below cites a `file:line` or a command with its output. Where the
task's "Verified facts" assumed something the repo no longer says (the latest
tag), the audit says so and gives both numbers.

---

## 1. Effect 4.0 status

### 1a. Installed version

`apps/server/package.json:23` → `"effect": "^4.0.0"`; the lockfile pins the
installed version:

```
$ grep -n "effect@" pnpm-lock.yaml
3985:   effect@4.0.0:
10634:  effect@4.0.0: {}
```

So the installed `effect` is **4.0.0** — 4.x as intended.

### 1b. Every module that imports `effect` today

```
$ grep -rEl "from ['\"]effect" --include='*.ts' --include='*.tsx' --include='*.js' apps packages devtools
apps/server/src/voice-transcription/pipeline.ts
apps/server/src/voice-transcription/pipeline.test.ts
```

Only two files, both in `apps/server/src/voice-transcription/`: the pipeline
(`pipeline.ts:16`) and its test. `effect` is a dependency of
`apps/server/package.json` only:

```
$ grep -rl '"effect"' --include=package.json apps packages devtools
apps/server/package.json
```

The pattern follows the guide: Effect runs inside, `Effect.runPromise` sits at
the edge (`docs/EFFECT_GUIDE.md:3-16`, `apps/server/src/voice-transcription/pipeline.ts:222-224`).

### 1c. Does "all the project" use Effect? No — by design

The plan is explicit: `docs/ROADMAP_EFFECT.md:8` ("Effect inside, promises at
the edges. Hono routes, React components, drizzle queries and better-auth keep
their current shape.") and `docs/ROADMAP_EFFECT.md:26` ("Not converted: UI
components, route handlers, drizzle query code, migrations, better-auth glue").
So "all the project" is not the goal; only the logic between the frameworks is.

### 1d. Candidate areas, by status

Table is `docs/ROADMAP_EFFECT.md:16-24`; the pair sequence is
`docs/ROADMAP_EFFECT.md:30-36`. Status is from the grep above plus the merge
history in `work/BOARD.md`.

| Area (roadmap) | Status | Evidence |
|---|---|---|
| Server voice transcription pipeline | **Converted** (the T-0173 spike) | `apps/server/src/voice-transcription/pipeline.ts:16`; merged `T-0173` (`da804c10`, `work/BOARD.md:223`). Other files in the folder (`provider.ts`, `routes.ts`, `settings.ts`) do not import `effect`; the pipeline is the converted part. |
| Web send pipelines in `realStore` | **Not converted** | No `effect` import under `apps/web`; Pair 3 is still future (`docs/ROADMAP_EFFECT.md:33`). |
| Mobile send and voice player | **Not converted** | No `effect` import under `apps/mobile`; Pair 4 is still future (`docs/ROADMAP_EFFECT.md:34`). |
| Push component and subscription sync | **Not converted** | No `effect` import in the push code. Note: the roadmap planned "new = T-0172 push component host (rewrite the component loop in Effect)" (`docs/ROADMAP_EFFECT.md:31`), but T-0172 as merged was a small host fix ("Push component dials the ejabberd service, not 127.0.0.1", `work/BOARD.md:259`), not an Effect rewrite. |
| Telegram sticker import | **Not converted** | No `effect` import in `apps/server/src/stickers/`. |
| Agent gateway and runner hub | **Not converted** | No `effect` import in `apps/server/src/agents/` or `machines/`. |
| Backup and deploy tooling (`devtools`, lead CLI) | **Not converted** | No `effect` import under `devtools/`. |

**Bottom line.** Effect 4.0 is installed everywhere it is a dependency, but
adopted in exactly one server module (the voice-transcription pipeline) plus its
test. Every other candidate area in the roadmap table is still open. The guide
and the vendored reference are current with 4.0.0
(`docs/effect-reference/README.md:3`).

---

## 2. README and docs freshness

Verdict per file. "Stale" means it contradicts the code/board today.

### READMEs

| File | Verdict | Detail |
|---|---|---|
| `README.md` | **Stale (missing info)** | "What it does" (`README.md:30-47`) and the M5 status paragraph (`README.md:115`) predate the merge window: no AI memory, chat backgrounds, forwarding/multi-select, media gallery/files panel, blocking or chat folders. |
| `apps/mobile/README.md` | **Stale** | Lines 8-14 describe the app as "the messenger-style chat shell from T-0019 (mock data), polished in T-0023". The app now runs on real data with settings, machines, approvals, AI tools/routines/activity, folders, backgrounds and more. |
| `apps/runner/README.md` | **Current** | Desks are still a later step (`apps/runner/README.md:44`), matching `packages/runner-tunnel` and the board. |
| `apps/site/README.md` | **Current** | Describes the landing site only; nothing in it is contradicted. |
| `packages/runner-tunnel/README.md` | **Stale** | Written as an M3 spike: "This is the spike … M3 builds on it" (`:5-6`), "Room-member authorization on previews is M3 work" (`:94`), "The key registry is in-memory here; M3 backs it with Postgres" (`:95`). M3 shipped (registry, runner, hub merged — `README.md:113`). |
| `packages/agent-drivers/README.md` | **Current** | Matches the driver in the package. |
| `work/README.md` | **Current** | Workflow and model names still match. |
| `docs/effect-reference/README.md` | **Current** | Pinned to `effect` 4.0.0 (`:3`), matching the lockfile. |

### Main docs

| File | Verdict | Detail |
|---|---|---|
| `docs/FEATURES.md` | **Stale (missing rows + history)** | Last history row is "2026-10-04 to 2026-10-05" (`docs/FEATURES.md:157`); everything merged after is absent. See the ready-to-paste rows below. |
| `docs/USER_GUIDE.md` | **Stale** | No background, AI memory, forwarding/multi-select, media/files panel, blocking or chat folders. Worse, it lists merged features as "(coming)": Voice messages (`:213`) merged in T-0154, mobile GIFs (`:215`) merged in T-0148, and "push in the production deploy" as "still planned" (`:211`) merged in T-0145. The page's own promise ("Everything below is in the app today unless it says **(coming)**", `:3`) is therefore wrong. |
| `docs/SERVER_CONFIG.md` | **Stale (missing env vars)** | Does not document `AVATAR_STORAGE_DIR` or `BACKGROUND_STORAGE_DIR` (see §2c). |
| `docs/INSTALL_DOCKER.md` | **Stale** | Storage table says "Voice \| Not built \| Planned" (`:362`) though voice messages shipped (T-0154). The avatar row (`:360`) and backup text (`:250`) do not mention that background wallpapers live under the avatar volume. Does not mention `BACKGROUND_STORAGE_DIR`. |
| `docs/INSTALL.md` | **Current** | Short pointer page; still accurate. |

### 2a. `FEATURES.md`: every user-visible feature merged since the last history row, missing from the file

The last history row is `docs/FEATURES.md:157` (2026-10-04 to 2026-10-05).
These rows are ready to paste into the file, in its own
`| Feature | What it does | Where | Status | Tasks |` format. All were merged
(green checks) but not clicked through live, so the mark is 🟡 **Merged** per
`docs/FEATURES.md:8`.

Section 1 (Chat):

```markdown
| Media gallery | Media / Files / Links / Voice tabs in a chat, backed by an incremental MAM media index; the same media sheet on the phone | server, web, mobile | 🟡 Merged | T-0410, T-0431, T-0434, T-0436, T-0448 |
| Forwarding and multi-select | Forward a message to another chat with an optional comment, and select several messages to forward in chat order; received forwards show "Forwarded from X [in Y]" | web, mobile | 🟡 Merged | T-0409, T-0414, T-0419, T-0427, T-0432, T-0435, T-0439, T-0445 |
| Chat backgrounds | A preset or an uploaded image as a chat background (this chat or the default); groups set theirs by owner/admin, members read it | server, web | 🟡 Merged | T-0457, T-0458, T-0460, T-0461, T-0462, T-0463, T-0464, T-0465, T-0466 |
| Uploaded files behind membership | Attachments, GIFs and voice notes load through `GET /api/files`, which checks the session and chat membership and streams with `Range`; the web uses it | server, web | 🟡 Merged | T-0453, T-0454, T-0459 |
```

Section 3 (AIs):

```markdown
| AI memory | An AI remembers durable facts and chat context automatically (mirror indexer, summary tree, recall/remember tools, per-chat facts, a compactor); "What <AI> remembers" on web and mobile | server, web, mobile | 🟡 Merged | T-0433, T-0437, T-0438, T-0440, T-0441, T-0442, T-0443, T-0444, T-0446, T-0447, T-0449, T-0451, T-0455 |
```

And the timeline row:

```markdown
| 2026-10-06 to 2026-10-07 | Media gallery, forwarding and multi-select, upload lock (`/api/files`), AI memory (M1-M6), chat backgrounds (presets, images, groups), blocking and chat folders, UI-kit migrations |
```

**Also missing, merged 2026-10-05** (the day the last history row closes, but
the row only names mobile parity waves, @handle search and lead tooling, so
these user-visible features are absent too — the lead should decide whether
they belong in the same catch-up):

```markdown
| Blocking people | Block and unblock a person; blocked people are hidden from previews and group messages; a Blocked page and a Requests-style flow on web and mobile | server, web, mobile | 🟡 Merged | T-0171, T-0235, T-0239, T-0244, T-0249, T-0252 |
| Chat folders | Server-backed chat folders with a reorderable page, a folder editor, and folder chips on web and mobile | server, web, mobile | 🟡 Merged | T-0231, T-0232, T-0237, T-0238, T-0248, T-0255 |
| @mention picker on mobile | The group composer suggests people and AIs; mentions render as chips and a mention of you stands out | mobile | 🟡 Merged | T-0227, T-0241 |
| Mobile bottom bar | Floating bar (Chats, AIs, Settings, Profile), search bar on Chats, Profile tab | mobile | 🟡 Merged | T-0233 |
| Mobile Settings hub redesign | Settings hub with a Blocked people row and tab header padding | mobile | 🟡 Merged | T-0247 |
```

### 2b. `SERVER_CONFIG.md` and the install docs: env vars they do not document

Extracted from `apps/server/src/config.ts` and compared with each doc:

- **`docs/SERVER_CONFIG.md` misses 2** of the 42 env vars in the core schema:
  - `AVATAR_STORAGE_DIR` (`config.ts:72`) — not mentioned anywhere in the file.
  - `BACKGROUND_STORAGE_DIR` (`config.ts:77`) — not mentioned anywhere in the file.
- **`docs/INSTALL_DOCKER.md`** does not mention `BACKGROUND_STORAGE_DIR`. (It
  documents `AVATAR_STORAGE_DIR` at `:250` and `:360`.)
- `apps/server/.env.example` does not list `AVATAR_STORAGE_DIR` or
  `BACKGROUND_STORAGE_DIR` either (both are hard-coded in
  `deploy/docker-compose.yml:148,153`), and neither does `deploy/.env.example`.

Note: `SERVER_CONFIG.md` does document the other 40 core vars (including
`ACTION_DEMO_ENABLED` at `:17`), and its "Mismatches found" section (`:343-348`)
already tracks `.env.example` gaps — but `AVATAR_STORAGE_DIR` /
`BACKGROUND_STORAGE_DIR` are missing from the reference itself.

### 2c. Where the new storage dir lives

`BACKGROUND_STORAGE_DIR` defaults to `./data/backgrounds` (`config.ts:77`) and
is set to `/data/avatars/backgrounds` in the production stack
(`deploy/docker-compose.yml:153`), reusing the existing `avatar-data` volume
(`:218`, `:289`). No new volume.

---

## 3. What a release could miss

Checklist, each item with its evidence.

- [ ] **Migrations since the last tag.** The task's "Verified facts" say the
  latest tag is `v0.1.9`, but that is not true any more:

  ```
  $ git tag | sort -V | tail -1
  v0.1.13
  $ git log -1 --format='%ci %s' v0.1.13
  2026-10-03 22:35:02 +0200 T-0178: quiet-point chunking via native amplitude envelope
  ```

  The task's requested command `git log v0.1.9..main -- apps/server/drizzle`
  lists **7** migrations (`0038`–`0044`); against the real latest tag it is
  **6**:

  ```
  $ git diff --name-only v0.1.13..main -- apps/server/drizzle | grep '\.sql$'
  0039_workable_sunspot.sql
  0040_majestic_legion.sql
  0041_blue_magneto.sql
  0042_lethal_tattoo.sql
  0043_giant_nitro.sql
  0044_demonic_gressill.sql
  ```

  `docs/FEATURES.md:156` itself records "release v0.1.13". The spec's `v0.1.9`
  is stale and should be corrected before it misleads a release. Head migration
  is `0044_demonic_gressill.sql`.

- [ ] **A migration and no fresh backup.** Auto-deploy runs on every green
  `main` (`docs/RELEASING.md:89-100`), and "a deploy that includes a migration
  does not take an extra backup" (`docs/RELEASING.md:134`). There are 6
  migrations since the last tag, so a merge with a destructive migration can
  reach the live database without a new dump. Procedure 1.3 still says to take
  a backup first (`docs/RELEASING.md:9`), but §9 auto-deploy bypasses that.

- [ ] **New env vars and volumes.** `BACKGROUND_STORAGE_DIR` is set in
  `deploy/docker-compose.yml:153` and needs no new volume (`:218`), but it is
  undocumented in `docs/SERVER_CONFIG.md` and `docs/INSTALL_DOCKER.md` (see
  §2b). An operator reading the reference will not know the directory exists.

- [ ] **New storage dir and backups.** Background wallpapers live under
  `/data/avatars/backgrounds`, i.e. inside the `avatar-data` volume. The backup
  helper archives the whole avatars directory:

  ```
  $ grep -n "archiving avatars" -A1 deploy/zilar
  968:  info "archiving avatars..."
  969:  compose exec -T server tar -C /data -czf - avatars > "$_tmp/avatars.tgz"
  ```

  So **wallpapers are already covered by `avatars.tgz`** — no backup gap. The
  gap is documentation only: neither `docs/INSTALL_DOCKER.md:360` nor
  `docs/SERVER_CONFIG.md` (avatars row, `:236`) mentions backgrounds.
  `docs/RELEASING.md:39` is separately stale: it says the file volumes
  "do not have a scheduled backup yet", but `./zilar backup` archives
  uploads, stickers and avatars and `deploy/backup-cron.example` schedules it
  (`docs/INSTALL_DOCKER.md:283-315`).

- [ ] **Features behind flags that are off by default.** From
  `apps/server/src/config.ts` (all default `false`): `AGENT_GATEWAY_ENABLED`
  (`:150`), `ACTION_DEMO_ENABLED` (`:158`), `RUNNER_HUB_ENABLED` (`:166`),
  `ROUTINES_ENABLED` (`:174`), `TOOLS_ENABLED` (`:184`), `WEB_TOOLS_ENABLED`
  (`:193`). Feature-off-by-absence: `PUSH_ENABLED`,
  `GIF_PROVIDER`/`GIF_API_KEY`, `TELEGRAM_BOT_TOKEN`,
  `LITELLM_MASTER_KEY`, `ZILAR_KEY_ENCRYPTION_KEY`. AI memory has no flag
  (planned "automatic, always on" — commit `60210d4f`), so it ships on. A
  release note that does not say which of these are off by default will read as
  "the feature is broken" to a fresh install.

- [ ] **Pending upload-lock cutover (needs Julio).** The server route and the
  web wiring are merged (`apps/server/src/files/routes.ts`, web mapper
  `apps/web/src/lib/attachments.ts:108`), but Caddy still serves uploads
  directly:

  ```
  deploy/caddy/Caddyfile:42-44   handle /upload/* { reverse_proxy ejabberd:5280 }
  ```

  Step 2 (volume wiring) and step 6 (the cutover plus a redirect window for old
  URLs) are still open (`docs/audit/upload-auth-plan.md:299-302`, `:319-322`).
  Web loads media through `/api/files`; **mobile still loads the direct
  `/upload` URL** (the route is only referenced in `apps/mobile` in
  `attachments.test.ts`), so mobile loads bypass the membership check today.

- [ ] **Mobile build and version numbers.** `apps/mobile/app.json:4` is
  `"version": "0.1.0"`, and there is no `android.versionCode` or
  `ios.buildNumber`; the root and server `package.json` are also `0.1.0` while
  the tags are at `v0.1.13`. The release build bakes
  `EXPO_PUBLIC_ZILAR_API_URL` at build time (`docs/RELEASING.md:48`), so a
  build made against the wrong URL cannot be fixed without a rebuild. Worth a
  deliberate decision on version bumping before a public tag.

- [ ] **Caddyfile vs new routes.** Every new HTTP surface is under `/api/*`
  or `/health` (e.g. `/api/files`, `/api/media`, `/api/ai-memory`), and the
  Caddyfile already routes `/api/*` (`deploy/caddy/Caddyfile:21`) and `/health`
  (`:27`). The only Caddy change a release needs is the upload cutover above;
  no new top-level route is missing.

- [ ] **Auto-deploy secrets.** The `deploy` job needs repository secrets
  `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_SERVICE_UUID` (and optional
  `ZILAR_PUBLIC_URL`, default `https://chat.zilar.app`) —
  `docs/RELEASING.md:104-109`. If any are missing, the deploy job skips while
  images still build (`docs/RELEASING.md:115-118`), so a release can look green
  and never reach the live install.

- [ ] **What `docs/RELEASING.md` §1 would fail on the current `main`.** Step 1
  says "`main` is pushed and CI is green" (`:7`). At audit time the local
  `main` is **2 commits ahead of `origin/main`**:

  ```
  $ git rev-list --left-right --count origin/main...main
  0	2
  ```

  so those two merges are not pushed. CI status cannot be checked from this
  worktree (`gh` is not run here). §1 also still frames releases around a tag,
  while §9 says the live install auto-deploys on green `main` "instead of
  waiting for a hand-made tag" (`:91`); the two sections should be reconciled
  so a release is not attempted twice.

---

## 4. Recommended order of fixes before the next tag

Docs-only unless noted; each line is one small task.

1. **`SERVER_CONFIG.md` + `INSTALL_DOCKER.md`:** document
   `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR`, and note that wallpapers
   live under the avatar volume and ride `avatars.tgz`
   (`docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md:360`).
2. **`FEATURES.md`:** paste the rows from §2a and add the 2026-10-06/07
   timeline row; decide whether the 2026-10-05 gaps (blocking, folders,
   mentions, bottom bar, settings hub) join the same catch-up.
3. **`USER_GUIDE.md`:** add backgrounds, AI memory, forwarding/multi-select,
   media/files panel, blocking and folders; remove the three wrong
   "(coming)"/"still planned" lines (`:211`, `:213`, `:215`).
4. **`README.md`:** add the same features to "What it does" and the M5 status
   paragraph.
5. **`apps/mobile/README.md`:** replace the "mock-data chat shell from
   T-0019" paragraph with the current feature set.
6. **`packages/runner-tunnel/README.md`:** move the M3 remarks to past tense.
7. **`INSTALL_DOCKER.md`:** fix the storage table's Voice row (`:362`).
8. **`RELEASING.md`:** correct §5's backup claim (`:39`) and reconcile §1's
   tag flow with §9's auto-deploy; state that a migration deploy does not take
   an extra backup (`:134`).
9. **Decision for Julio:** bump `apps/mobile/app.json` version / add
   `versionCode`/`buildNumber` before any public mobile build.
10. **Decision for Julio:** the upload-lock cutover steps 2 and 6
    (`docs/audit/upload-auth-plan.md`), including the redirect window and the
    mobile minimum-version announcement.

---

## Appendix: commands run for this audit

```bash
git tag | sort -V                                   # latest: v0.1.13
git log -1 --format='%ci %s' v0.1.13                # 2026-10-03
git diff --name-only v0.1.13..main -- apps/server/drizzle | grep '\.sql$'
git log v0.1.9..main --stat -- apps/server/drizzle  # 7 migrations
git rev-list --left-right --count origin/main...main # 0  2
grep -rEl "from ['\"]effect" --include='*.ts' apps packages devtools
grep -rl '"effect"' --include=package.json apps packages devtools
grep -n "effect@" pnpm-lock.yaml                     # effect@4.0.0
```

`docs/FEATURES.md`, `docs/RELEASING.md`, `docs/SERVER_CONFIG.md`,
`docs/INSTALL_DOCKER.md`, `docs/USER_GUIDE.md`, `docs/INSTALL.md`,
`docs/EFFECT_GUIDE.md`, `docs/ROADMAP_EFFECT.md`, the READMEs,
`apps/server/src/config.ts`, `deploy/docker-compose.yml`,
`deploy/caddy/Caddyfile`, `deploy/zilar` and `work/BOARD.md` were read
directly (line ranges cited above).
