# Dedup status audit (T-1051, 2026-10-10)

Read-only. For each shared-code item **F1–F7** of `docs/audit/size-plan.md` §4.1
(lines 276–282) this says what is left on `main` today, with `grep`/`wc` evidence
and `file:line`, whether the copies are identical or drift, and task slices of at
most ~400 changed lines. No code was changed.

Every number below was measured in this worktree (branch
`task/T-1051-audit-dedup-status`). Test files, `test-support.ts` and
`test-harness.ts` are excluded from counts unless stated. **Deferred and out of
scope for every slice:** `apps/server/src/main.ts`, `apps/server/src/app.ts`,
`apps/server/src/agents/gateway/*`, `apps/server/src/sandbox/tool-worker.ts`,
`packages/runner-tunnel/**`, and the stores (`apps/*/src/store/**`).

## 0. Summary

| Item | What | Status on main | Left |
| --- | --- | --- | --- |
| F1 | shared `runSql` | done | 6 service call sites |
| F2 | error envelope + typed `handler` | mostly done | 7 `withErrorEnvelope`, ~26 `requestIdOf`, 327 `throw new HttpError` |
| F3 | one schema-error layer | done | 26 one-line provides (cosmetic) |
| F4 | rate-limit middleware factory | half done | 6 hand-written layers, 31 inline `allow` checks in 22 modules |
| F5 | `groups/access.ts` | not started | ~40 `group_members` reads, 2 `requireGroupManager`, inline role checks |
| F6 | small duplicates (incl. F6a done) | partly done | crypto ×3, `bareJid` ×5, scrub, issue walker ×4, `truncateChars` ×4, `readCapped` ×4 |
| F7 | web API contract facade | split done, derivation not | 1,785 hand-written lines in `lib/api/api/*.ts` |

F6a (`errorName`/`errorClassName` and `isUniqueViolation`) is done by T-1043; F8a/b
are running (T-1049, T-1050). The F3 and F1 helpers already exist, so the
remaining work is adoption, not design.

## 1. F1 · Server query helper `runSql` — done

- Helper: `apps/server/src/effect/sql.ts:111` `runSql` (wraps
  `apps/server/src/effect/sql.ts:99` `sqlRuntimeFor(db).runPromise`).
- **522** `runSql(` call sites remain (excludes the definition).
- **9** direct `sqlRuntimeFor(...).runPromise` call sites remain, exactly the
  ones in the spec: `blocks/service.ts:138`, `pins/access.ts:48`,
  `pins/service.ts:129`, `auth/sql-adapter.ts:155`, `roles/service.ts:84`,
  `voice-transcription/pipeline.ts:157`, `app.ts:597` (deferred),
  `db/migrate.ts:9`, `test-support.ts:304`.
  - `db/migrate.ts:9` is the migration bootstrap: it runs before the runtime is
    registered, so it must stay.
  - `effect/sql.ts:115` also matches the pattern but is `runSql`'s own body.
  - `sql-adapter.ts:2` is a comment.
- **What is left:** the 6 service sites (`blocks`, `pins ×2`, `auth`,
  `roles`, `voice-transcription`). Behaviour-identical: each already runs the
  same program on the same registered runtime.

## 2. F2 · Error envelope and typed `handler` — mostly done

Helpers already exist in `apps/server/src/effect/http-core.ts`:
`withErrorEnvelope` (`:190`), `handler` (`:208`), `failureResponse` (`:169`),
`httpErrorResponse` (`:151`). `handler(` is used **155×** across the modules and
`.handle(` is declared **148×**. `HttpError` is `errors.ts` (23 lines).

Left today:

- **7** `withErrorEnvelope(` call sites, all inside a module that has not moved to
  `handler`: `pins/api.ts:76,92,106`, `auth/api.ts:225`, `setup/api.ts:216,232`,
  `machines/api.ts:311`.
- **~26** direct `requestIdOf(` uses in modules, for the custom envelope
  responses the rate limiters build: `chat-folders/api.ts:79,100,115,147`,
  `chat-prefs/api.ts:107,135`, `groups/api.ts:72,93`, `invite-links/api.ts:91`,
  `search/api.ts:48`, `integrations/api.ts:72,103`, `audit/api.ts:66`,
  `voice-transcription/middleware.ts:30,65,72`, `topics/api.ts:66`,
  `handles/api.ts:118`, `ais/api.ts:122`, `machines/api.ts:384`,
  `setup/api.ts:215,231`. Most are F4's inline limiters, so F2 and F4 overlap.
- **327** `throw new HttpError(` (in 90 files) plus **16**
  `Effect.fail(new HttpError(`: the "`HttpError` as a defect" pattern still runs
  through `failureResponse`, which renders it byte-identically. Removing it is a
  large mechanical item, not required for correctness.

**Identical?** Yes — every remaining site renders the same body as `handler`;
moving them changes no behaviour.

## 3. F3 · One schema-error layer — done (cosmetic only)

The shared layer is `apps/server/src/effect/http-core.ts:93`
`schemaErrorLayer` / `:97` `schemaErrorLayerFor`. **No hand-written schema-error
wrapper is left.** Modules still provide the shared one-liner once each:

- `schemaErrorLayer(logger)`: **19** files (`blocks`, `pins`, `tools/routes`,
  `auth`, `chat-folders`, `chat-prefs`, `agents/memory`, `roles`, `groups`,
  `directory`, `gifs`, `invite-links`, `integrations`, `backgrounds`, `push`,
  `routines`, `voice-transcription`, `topics`, `media`).
- `schemaErrorLayerFor(...)`: **7** files (`handles`, `stickers`, `ais`,
  `search`, `contact-requests`, `audit`, `approvals`).

The planned ~420 removed lines are already gone; what remains is 26
`Layer.provide(schemaErrorLayer…(logger))` lines. **What is left:** nothing that
must change. An optional slice could chain the default layer once in
`effect/http-core.ts` `mountApi` (`:270`) so modules stop providing it, but it
saves ~26 lines and is not worth a task on its own.

## 4. F4 · Rate-limit middleware factory — half done

Factory exists: `apps/server/src/effect/rate-limit-middleware.ts:36`
`rateLimitLayer` / `:59` `makeRateLimit`, over
`apps/server/src/rate-limit.ts:16` `createRateLimiter`.

- Adopted: **12** `rateLimitLayer(` call sites (`blocks/api.ts:101,102`,
  `pins/api.ts:126`, `handles/api.ts:151`, `stickers/api.ts:86`,
  `agents/memory/api.ts:211`, `directory/api.ts:103`,
  `contact-requests/api.ts:191,193,195`, `backgrounds/api.ts:164`,
  `machines/api.ts:395`) and **1** `makeRateLimit(` (`xmpp/api.ts:50`).
- **43** `createRateLimiter(` instances are built across the server.
- **What is left:**
  1. **6 hand-written layer functions** that open-code the same
     `allow` → 429 envelope: `groups/api.ts:63 roleRateLimitLayer`,
     `groups/api.ts:84 joinRateLimitLayer`, `invite-links/api.ts:82
     previewRateLimitLayer`, `integrations/api.ts:62 telegramRateLimitLayer`,
     `integrations/api.ts:92 emailRateLimitLayer`, `topics/api.ts:57
     createRateLimitLayer`.
  2. **31 inline `if (!x.allow(...))` checks in 22 modules**: `avatars/api.ts`,
     `chat-prefs/api.ts`, `connections/api.ts`, `files/api.ts`, `gifs/api.ts`,
     `groups/api.ts`, `handles/api.ts`, `integrations/api.ts`,
     `invite-links/api.ts`, `machines/api.ts`, `media/api.ts`,
     `push/api-handlers.ts`, `push/api-subscribe.ts`, `search/api.ts`,
     `setup/api.ts`, `stickers/api-decode.ts`, `tools/routes.ts`,
     `tools/tool-adapters.ts`, `topics/api.ts`, `voice-transcription/api.ts`,
     `voice-transcription/middleware.ts`, `web-tools/shared.ts`
     (plus the shared layer's own check at `effect/rate-limit-middleware.ts:46`).
     Three more files hand-roll the same check in another shape:
     `chat-folders/api.ts:58` (`checkWriteLimit`), `backgrounds/api.ts:66` and
     `stickers/api.ts:67` (injected limiter wrappers).

**Identical?** Behaviour is the same (the shared layer spends the budget before
the body, matching the inline order), but the inline sites use different keys
(`user.id`, `clientIp(...)`, a global `'runner-pair'`, a custom
`webRateLimitKey`). A move must keep each key and each `max`/`windowMs`.
**Security: rate limits — move unchanged or lead decision.**

## 5. F5 · `groups/access.ts` — not started

`apps/server/src/groups/access.ts` **does not exist**. Per-feature access files
exist instead (`approvals/access.ts`, `chat-prefs/access.ts`, `pins/access.ts`,
`roles/access.ts`, `routines/access.ts`, `tools/access.ts`, `topics/access.ts`)
and each re-reads membership itself.

- **65** `group_members` mentions (~40 real SQL call sites) across
  `groups/{queries,members,visibility,join,ais,service}.ts`,
  `topics/{queries,access,members,room-members,room-push}.ts`,
  `approvals/{queries,api,rules,access}.ts`, `roles/{access,queries,service}.ts`,
  `invite-links/{queries,join}.ts`, `audit/list.ts`, `backgrounds/service.ts`,
  `avatars/service.ts`, `directory/service.ts`, `routines/reads.ts`,
  `tools/access.ts`; plus `agents/gateway/db.ts` (deferred).
- **29** `topic_members` mentions.
- **`requireGroupManager` is copied twice**: the shared
  `roles/access.ts:31` and a private `invite-links/queries.ts:26`. The
  `role === 'owner' || role === 'admin'` decision is re-inlined in
  `tools/access.ts:48,113`, `routines/access.ts:72,102`,
  `approvals/access.ts:76,221`, `approvals/rules.ts:293`, `audit/list.ts:223`,
  `groups/queries.ts:155`.

**Identical?** No single pair is a verbatim clone, but all answer the same
question ("is this user a member / manager of this group?") with the same
tables. A shared helper must not change any answer, especially the 404-vs-403
choice. **Security: permissions — move unchanged or lead decision.**

## 6. F6 · Small duplicates — partly done

T-1043 (F6a) is merged: `errorName`/`errorClassName` and `isUniqueViolation`
live in `apps/server/src/effect/error-utils.ts:9,18,28` and are imported
everywhere. One local `errorName` copy is left at `agents/gateway/contracts.ts:253`
(**deferred, skip**). `isUniqueViolation` has no copy left. Items remaining:

### 6.1 Crypto envelope ×3 (keys)

`push/crypto.ts` (100), `connections/crypto.ts` (105), `setup/crypto.ts` (106).
Lines `push/crypto.ts:43-91`, `connections/crypto.ts:47-95` and
`setup/crypto.ts:48-96` are **byte-identical** (`deriveKey`, `encryptOnce`,
`decryptOnce`). They differ only in: the HKDF label constant
(`PUSH_STORAGE_KDF_LABEL` / `PROVIDER_KEY_KDF_LABEL` /
`INSTANCE_SETTINGS_KDF_LABEL`), the error class
(`PushDecryptionError` / `DecryptionError` / `SettingsDecryptionError`), the
interface and the factory name. A shared envelope parameterised by
`{label, error class}` removes ~98 identical lines with no behaviour change, as
long as each module keeps its own label and error type (a blob sealed for one
purpose must still fail for another).
**Security: keys — move unchanged or lead decision.**

### 6.2 `bareJid` ×5 and `ownBareJid` ×2

- `agents/context.ts:40` (exported, `indexOf`/`slice`),
  `agents/memory/indexer.ts:79`, `search/routes.ts:121`,
  `push/candidates.ts:180` (`bareJidOf`), `media/api.ts:137` — the last four are
  the same one-liner `jid.split('/')[0]?.toLowerCase() ?? ''`.
- `ownBareJid`: `search/routes.ts:140` and `push/candidates.ts:176`, identical.
  **Identical?** Yes functionally (the `indexOf` form equals the `split` form on
  every input). **Security: none.** (F6 also names `bareJid` → `protocol`.)

### 6.3 Secret scrub

`redactSecrets` is one shared copy (`ai/litellm-client.ts:254`) already imported
by `agents/*`, `connections/probe.ts`, `main.ts` (deferred). A separate
`scrubTokenText` lives in `stickers/telegram/errors.ts:77` and is used by
`stickers/telegram/client.ts:33,61`. **What is left:** unify the Telegram token
scrub onto the shared scrub, or keep it (its input is a known token, not a
secret list). **Security: secrets — lead decision.**

### 6.4 Schema-issue walker ×4

`firstIssueMessage` has **four copies**:
`auth/api.ts:74`, `routines/schemas.ts:121`, `audit/schema.ts:75`,
`xmpp/admin/errors.ts:53`; plus the sibling `firstIssueReason` in
`agents/tool-arg-issues.ts:14`. No `apps/server/src/effect/schema-issues.ts`
exists (F8 lists it).

**Identical?** Not all four (lead `diff`, 2026-10-10):
- `xmpp/admin/errors.ts` is the same as `auth/api.ts`.
- `routines/schemas.ts` differs only in a `{ }` block around `case 'AnyOf'`, so it behaves the same.
- `audit/schema.ts` has two extra cases: `InvalidType` returns `SchemaIssue.defaultLeafHook(issue)`, and `MissingKey` returns `'Missing key'`. Its messages differ.

Extract the shared switch to `effect/schema-issues.ts`, and either keep audit's two cases as an audit-only wrapper, or choose deliberately to change audit's messages.

### 6.5 `truncateChars` ×4 (+ a variant)

`web-tools/guarded-fetch.ts:391`, `tools/adapter-support.ts:102`,
`routines/outcomes.ts:43` are **byte-identical** (slice + `…`).
`actions/support.ts:12` `truncateText` is the same without the `…`.
`push/payload.ts:87` **differs**: it uses `Array.from` (code-point safe) so it
never splits an emoji, and must keep that behaviour — either keep it or give the
shared helper a code-point mode. `push/payload.ts:95` `truncateUtf8` and
`tools/runner.ts:208` `truncateBytes` are byte caps, a different concern.

### 6.6 One capped read ×4

`readCapped` is **byte-identical** in four files:
`stickers/api-upload.ts:108`, `backgrounds/api.ts:178`, `voice/api.ts:139`,
`avatars/api.ts:200`. `stickers/telegram/transport.ts:81,118`
(`readDownloadBody`, `readEnvelopeBody`) are a Response-body variant.
**Identical?** Yes for the four stream copies.

## 7. F7 · Web API contract facade — split done, derivation not

- `apps/web/src/lib/api.ts` is **284 lines**, a barrel of re-exports (T-0959),
  not the old 1,792-line file.
- The transports now live in `apps/web/src/lib/api/*.ts`: **1,785 lines** across
  `machines.ts` (45), `people.ts` (107), `http.ts` (114), `media.ts` (138),
  `topics.ts` (143), `ais.ts` (228), `chats.ts` (228), `settings.ts` (228),
  `stickers.ts` (252), `groups.ts` (302).
- They already import the schemas from `@zilar/api-contract`, but they are still
  hand-written `request(...)`/`fetch` wrappers (10 `request(` sites) — not thin
  facades over the derived client. The derived client exists
  (`packages/api-contract/src/client.ts:70` `makeZilarClient`,
  `apps/web/src/lib/effect/api-client.ts:38` `zilarClient()`), and server smoke
  tests already use it.
- **What is left:** move each `api/*.ts` function body onto the derived
  `ZilarClient`, keeping the exported names (Phase 3.3). Mark the setup/keys and
  avatar/background upload modules **security: keys — move unchanged or lead
  decision**.

## 8. Proposed slices (≤ ~400 changed lines each)

Order: shared helpers first, then adoption, then the web facade. Deferred files
are never touched.

| # | Slice | Files (exact) | Est. lines | Security flag |
| --- | --- | --- | ---: | --- |
| S1 | F1: last `sqlRuntimeFor` service sites → `runSql` | `blocks/service.ts`, `pins/access.ts`, `pins/service.ts`, `auth/sql-adapter.ts`, `roles/service.ts`, `voice-transcription/pipeline.ts` | ~30 | auth site: move unchanged |
| S2 | F2: the 3 `pins/api.ts` `withErrorEnvelope` blocks → `handler` (lead, 2026-10-10: `auth/api.ts:225`, `setup/api.ts:216,232` and `machines/api.ts:311` are public routes with no session, so `handler`, which needs `CurrentUser`, cannot serve them) | `pins/api.ts` | ~30 | none |
| S3 | F6c+6e: one `bareJid`/`ownBareJid`; one `truncateChars` | new `apps/server/src/effect/jid.ts`, `apps/server/src/effect/text.ts`; `agents/context.ts`, `agents/memory/indexer.ts`, `search/routes.ts`, `push/candidates.ts`, `media/api.ts`, `web-tools/guarded-fetch.ts`, `tools/adapter-support.ts`, `routines/outcomes.ts`, `actions/support.ts` | ~90 | none |
| S4 | F6d: one schema-issue walker | new `apps/server/src/effect/schema-issues.ts`; `auth/api.ts`, `routines/schemas.ts`, `audit/schema.ts`, `xmpp/admin/errors.ts` | ~90 | auth site: move unchanged |
| S5 | F6f: one `readCapped` | new `apps/server/src/effect/read-capped.ts`; `stickers/api-upload.ts`, `backgrounds/api.ts`, `voice/api.ts`, `avatars/api.ts` | ~90 | none |
| S6 | F6b: one crypto envelope | new `apps/server/src/effect/crypto-envelope.ts`; `push/crypto.ts`, `connections/crypto.ts`, `setup/crypto.ts` | ~130 | **security: keys — lead decision** |
| S7 | F4: hand-written layers → factory (a) | `groups/api.ts`, `topics/api.ts`, `invite-links/api.ts` | ~120 | **security: rate limits — move unchanged** |
| S8 | F4: hand-written layers → factory (b) | `integrations/api.ts` + 8 inline sites (`chat-folders/api.ts`, `chat-prefs/api.ts`, `gifs/api.ts`, `search/api.ts`, `files/api.ts`, `media/api.ts`, `avatars/api.ts`, `backgrounds/api.ts`) | ~200 | **security: rate limits — move unchanged** |
| S9 | F4: remaining inline sites → factory | `connections/api.ts`, `machines/api.ts`, `handles/api.ts`, `stickers/api.ts`, `stickers/api-decode.ts`, `tools/routes.ts`, `tools/tool-adapters.ts`, `push/api-handlers.ts`, `push/api-subscribe.ts`, `setup/api.ts`, `voice-transcription/api.ts`, `voice-transcription/middleware.ts`, `web-tools/shared.ts` | ~220 | **security: rate limits — move unchanged** |
| S10 | F5: build `groups/access.ts` + adopt in groups/topics | new `apps/server/src/groups/access.ts`; `groups/{queries,members,visibility,join,ais}.ts`, `topics/{queries,access,members,room-members}.ts` | ~350 | **security: permissions — lead decision** |
| S11 | F5: adopt in roles/invite-links/approvals/audit | `roles/{access,queries,service}.ts`, `invite-links/{queries,join}.ts`, `approvals/{queries,api,rules,access}.ts`, `audit/list.ts`, `avatars/service.ts`, `backgrounds/service.ts` | ~300 | **security: permissions — lead decision** |
| S12 | F7: facade `chats` + `groups` | `apps/web/src/lib/api/{chats,groups}.ts` | ~350 | none |
| S13 | F7: facade `topics` + `ais` + `machines` | `apps/web/src/lib/api/{topics,ais,machines}.ts` | ~380 | none |
| S14 | F7: facade `stickers` + `media` + `people` | `apps/web/src/lib/api/{stickers,media,people}.ts` | ~350 | none |
| S15 | F7: facade `settings` + `http` | `apps/web/src/lib/api/{settings,http}.ts` | ~300 | **security: keys — move unchanged** |

S1–S3 and S5 are behaviour-identical mechanical moves. S4 touches auth's issue
walker (move unchanged). S6, S7–S9, S10–S11 and S15 carry security flags and
need Julio/lead sign-off before a worker runs them.

## 9. Recommended order

1. **S1** (F1 finish) — smallest, unblocks nothing but closes the item.
2. **S2** (F2 finish) — small, removes the last non-`handler` sites.
3. **S3, S4, S5** (F6 helpers) — pure helpers; S4 before the F2/F3 cleanup
   because the issue walker is used by the envelope paths.
4. **S6** (F6 crypto) — only after the keys decision.
5. **S7, S8, S9** (F4) — after the rate-limit decision; S7 is the smallest.
6. **S10, S11** (F5) — after the permissions decision; these turn the later file
   splits into mechanical moves, so they precede any >400-line split task.
7. **S12–S15** (F7) — last; needs the Phase 3.3 contract, and each module is an
   independent ~350-line slice.

F3 needs no task (done). F6a is done (T-1043); F8a/b are running (T-1049,
T-1050) and are not repeated here.
