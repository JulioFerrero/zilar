---
id: T-0030
title: M2 — AIs on the server: profiles, their own XMPP account, a capped LiteLLM virtual key
status: review
milestone: M2
branch: task/T-0030-ais-server
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0028, T-0007, T-0017]
estimate: 1.5 days
---

# T-0030: AIs on the server

## Spec (written by Claude, do not edit)

### Goal
M2 is "AIs that talk". Before an AI can talk it has to **exist**: a row that
says who owns it, which model it uses through which of the owner's provider
connections, and what it may spend; its own XMPP account, so it appears in chats
like a person; and a LiteLLM virtual key with a hard cap, so every model call it
ever makes is limited by the gateway, not by our good intentions.

This task builds that, **server only**, behind `/api/ais`. The web wizard
(T-0032) and replying to @mentions (T-0033) come next and build on this API, so
get the shapes right.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §8.1 (what an AI is), §8.3–8.4 (keys, budgets),
  §19 (`ais`, `ai_limits`, `llm_virtual_keys`), §20.2 (the wizard), and the
  "Three core rules" in §5 (rule 3: AIs never hold real keys)
- `work/T-0007-litellm-virtual-keys.md`: the Report's **decision note** (how keys
  are stored, rotated, and what a hit cap looks like)
- `apps/server/src/ai/litellm-client.ts` and `ai/routes.ts` (the comment on why
  a cap is server-owned)
- `apps/server/src/connections/**` (T-0028): the module layout, `KeyCipher`,
  `findOwnedConnection`, the 404-not-403 rule, the `.strict()` idiom, and how
  `app.ts` injects test doubles through `AppDependencies`
- `apps/server/src/xmpp/provisioning.ts`, `admin-client.ts`, `token.ts`
- `apps/server/src/contacts/**`: how roster entries are made between people
- `apps/server/src/db/schema.ts` and the migration mechanism
  (`pnpm --filter @galena/server db:generate`)

### Allowed files
- `apps/server/src/ais/**` (new module: service, routes, tests)
- `apps/server/src/db/schema.ts` and the generated migration + drizzle meta files
- `apps/server/src/app.ts` — to mount the routes and inject test doubles
- `apps/server/src/xmpp/admin-client.ts` — **only** to add `unregisterUser`
  (ejabberd's `unregister` command) and its test
- `apps/server/src/connections/routes.ts`, `connections/service.ts` and their
  tests — **only** for item 6
- `work/T-0030-ais-server.md`

**Not allowed:** `apps/web/**`, `apps/mobile/**`, `packages/**`, `infra/**`,
`docs/**`, `apps/server/src/ai/**` (reuse it, don't change it). If you need a
change there, describe it in the Report and stop.

> T-0008 (`packages/runner-tunnel`) and T-0031 (`apps/mobile`) run in parallel.
> Stay out of their folders.

### Allowed dependencies
None.

### What to build

**1. Storage.** Following the plan's §19, with exactly these columns:
- `ais`: `id`, `owner` (user id, FK, cascade), `name`, `template`
  (`dev` | `marketing` | `fun` | `custom`), `persona` (text), `provider_connection_id`
  (FK to `provider_connections`, **restrict** on delete), `model` (text),
  `localpart` (unique), `jid` (unique), `status` (`active` | `disabled`),
  `created_at`, `updated_at`.
- `ai_limits`: `ai_id` (PK, FK cascade), `per_day_usd`, `per_month_usd`
  (numeric), `updated_at`.
- `llm_virtual_keys`: `ai_id` (PK, FK cascade), `litellm_key_id`,
  `encrypted_key` (the key string, sealed with the T-0028 `KeyCipher`: the server
  needs the usable key in T-0033 to call LiteLLM **as the AI**, so the cap
  applies), `budget_usd`, `budget_duration`, `created_at`.

**2. Routes, all behind `requireSession`, owner-only.**
- `GET /api/ais` (the caller's AIs) and `GET /api/ais/:id`.
- `POST /api/ais` — create. Body (zod, `.strict()`): `name` (trimmed, 1–64),
  `template`, `persona` (≤ 4000, optional; default by template, see below),
  `providerConnectionId`, `model` (1–256), `limits { perDayUsd, perMonthUsd }`.
- `PATCH /api/ais/:id` — `name`, `persona`, `limits` only (`.strict()`).
- `DELETE /api/ais/:id`.
- The public shape is `{ id, name, template, persona, model, jid, status,
  providerConnectionId, limits: { perDayUsd, perMonthUsd }, createdAt }`.
  **Never** the virtual key, its id, or anything from the connection's key.
- Missing or foreign id → the same 404. The connection must be the caller's own,
  `active`, and an LLM provider (not `github`); otherwise 400 with a clear code.
- Limits: the owner sets them (§8.1 "hard limits, set by owner"). This does not
  contradict the T-0007 comment: that one stops the **key holder** from lifting
  its own cap; here the authenticated **owner** sets it, bounded by the server.
  Enforce on the server: both > 0, `perDayUsd ≤ perMonthUsd`, and
  `perMonthUsd ≤ 200` (a server constant with a comment).
- Template personas: a short default persona per template in one small module
  (`dev`: concise senior engineer; `marketing`: clear, friendly copywriter;
  `fun`: playful group-chat host; `custom`: empty, persona required). Keep them
  to two or three sentences each.

**3. The AI's XMPP identity** (it is an XMPP user like a person, §5).
- Localpart `ai-` + a stable id-derived suffix, valid per the admin client's rules.
- On create: register the account; add roster entries **both ways** between the
  owner and the AI (subscription `both`, the AI's `name` as the owner's roster
  name for it), the same way `contacts` does for people. The owner must have an
  XMPP account (use `ensureXmppAccount`).
- On rename (`PATCH name`): update the owner's roster name for the AI.

**4. The capped virtual key.**
- On create: `generateKey` with `max_budget = perMonthUsd`, `budget_duration =
  '30d'`, `models = [model]`, and an alias/metadata naming the AI id. Store the
  key id and the sealed key string (item 1). The key string never appears in a
  response or a log (reuse `redactSecrets`).
- On `PATCH limits`: `updateKey` with the new monthly budget, then update the
  rows. `perDayUsd` is stored for the daily ledger in a later task; say so in a
  comment. Do not pretend LiteLLM enforces it.

**5. Creation is all-or-nothing.** Order: insert the rows (`status` active only at
the end), register XMPP, roster, virtual key. If any external step fails,
**compensate** what was done (revoke the key, delete roster entries, unregister
the XMPP account, delete the rows) and return **502** `ai_provisioning_failed`
with a sanitised message. A compensation step that itself fails is logged (no
secrets) and does not mask the original error.
`DELETE` does the same teardown in reverse order: revoke key → roster → XMPP
account → rows. If ejabberd or LiteLLM is down, `DELETE` returns 502 and leaves
the AI in place so it can be retried; it never half-deletes the row.

**6. Deleting a connection that an AI uses.** `DELETE /api/connections/:id` must
return **409** `connection_in_use` (listing no AI details, just the count), not
a database error.

### Tests (Vitest, fakes for ejabberd and LiteLLM, PGlite)
- create → list → get → patch → delete, and the public shape never contains the
  key (search every response body for the fake key string and its id).
- auth required; foreign and missing ids are the same 404 on get, patch, delete.
- `.strict()` rejects unknown fields on create and patch; limits outside the
  bounds are rejected; `perDayUsd > perMonthUsd` is rejected.
- connection checks: another user's connection, a `github` connection, and a
  missing one are rejected.
- **each** external failure during create (register, roster, key) leaves **no**
  rows and triggers the right compensations (assert on the fakes' call logs).
- delete with LiteLLM down returns 502 and keeps the AI.
- `PATCH limits` calls `updateKey` with the new budget.
- renaming updates the roster name.
- deleting a connection in use returns 409.
- `unregisterUser` sends the right command (admin-client test).

### Integration check (gated, the lead runs it)
Write `apps/server/src/ais/integration.test.ts`, gated by
`GALENA_AIS_INTEGRATION=1`, against a real server: sign in, create a connection
with a made-up key, create an AI, check through the admin client that the XMPP
account exists and is in the owner's roster, check through LiteLLM `/key/info`
that the cap equals `perMonthUsd`, patch the limit and check again, delete, and
check that the account and key are gone. List the env vars it needs at the top,
like `connections/integration.test.ts`. **Do not start a server or run it
yourself**; the lead does, after review.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `pnpm exec turbo test --force`, `build` pass.
- [ ] Every test named above exists and passes.
- [ ] No response, log line or error message can contain a virtual key or a
      provider key.
- [ ] Creation and deletion never leave half an AI behind.
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Any UI (T-0032), and the AI actually replying (T-0033).
- Adding AIs to groups or DMs other than the owner's roster.
- Avatars, fallback models, tool packs, placement, memory, autonomy tiers.
- Registering the user's provider key in LiteLLM (T-0033 decides how the key
  reaches the provider).
- Workspace-owned AIs (there are no workspaces yet).

---

## Report (written by the worker when done)

### What I did

Built the server-side AI module behind `/api/ais` (M2), following the spec.

**Storage** (`apps/server/src/db/schema.ts`, migration `0005_clean_frightful_four.sql`):
- `ais` with exactly the spec's columns (`id`, `owner`, `name`, `template`
  dev|marketing|fun|custom, `persona`, `provider_connection_id` FK RESTRICT,
  `model`, `localpart` unique, `jid` unique, `status` active|disabled,
  `created_at`, `updated_at`) plus an `ais_owner_idx` index for the list query.
- `ai_limits` (`ai_id` PK cascade, `per_day_usd`, `per_month_usd` numeric(12,2),
  `updated_at`).
- `llm_virtual_keys` (`ai_id` PK cascade, `litellm_key_id`, `encrypted_key`,
  `budget_usd`, `budget_duration`, `created_at`).

**Routes** (`apps/server/src/ais/routes.ts`), all `requireSession` and
owner-only:
- `GET /api/ais`, `GET /api/ais/:id`, `POST /api/ais`, `PATCH /api/ais/:id`,
  `DELETE /api/ais/:id`.
- Create/patch bodies are zod `.strict()`; unknown fields are 400. Limits must
  be positive, `perDayUsd <= perMonthUsd`, and `perMonthUsd <= MAX_MONTHLY_USD`
  (a server constant, 200, with a comment). A `custom` AI without a persona is
  400.
- The public shape is exactly `{ id, name, template, persona, model, jid,
  status, providerConnectionId, limits: { perDayUsd, perMonthUsd }, createdAt }`.
  The virtual key string, its LiteLLM id, and the connection's key are never
  returned; the tests search every body for them.
- Missing/foreign id -> the same 404. The connection must be the caller's,
  `active` and not `github`, else 400 (`invalid_connection` /
  `connection_inactive` / `connection_not_llm`).

**XMPP identity** (`apps/server/src/ais/service.ts`): localpart `ai-` + the
existing id-derived suffix. On create the owner's account is ensured, the AI is
registered, and two roster items are written (subscription `both`, group
`Galena`): the AI in the owner's roster under the AI's name, the owner in the
AI's roster. On rename the owner's roster nickname is updated. `unregisterUser`
(ejabberd `unregister`) was added to the admin client.

**Capped virtual key**: `generateKey` with `max_budget = perMonthUsd`,
`budget_duration = '30d'`, `models = [model]`, alias `galena-ai-<id>` and
metadata `{ ai_id }`. The key id and the key string sealed with the T-0028
`KeyCipher` are stored; the plaintext exists only in memory. `PATCH limits`
calls `updateKey` with the new monthly budget first, then updates the rows.
`per_day_usd` is stored for the later daily ledger and is explicitly not
enforced by LiteLLM (comment in `service.ts`).

**All-or-nothing** create: rows are inserted `disabled`, then XMPP register ->
roster -> virtual key -> `status = 'active'`. Any external failure compensates
(revoke key, delete both roster items, unregister, delete rows) and answers 502
`ai_provisioning_failed`; a compensation failure is logged and never masks the
original. `DELETE` does the reverse teardown (revoke -> roster -> unregister ->
rows); if the gateway or ejabberd is down it answers 502 and keeps the AI.

**Connections**: `DELETE /api/connections/:id` now returns 409
`connection_in_use` with the bare count before the RESTRICT FK can fire.

### Files changed

- `apps/server/src/ais/templates.ts` (new) — template enum + default personas.
- `apps/server/src/ais/service.ts` (new) — storage, XMPP, gateway, rollback.
- `apps/server/src/ais/routes.ts` (new) — `/api/ais` routes.
- `apps/server/src/ais/routes.test.ts` (new, 14 tests).
- `apps/server/src/ais/integration.test.ts` (new, gated by
  `GALENA_AIS_INTEGRATION=1`; not run).
- `apps/server/src/db/schema.ts` — `ais`, `ai_limits`, `llm_virtual_keys`.
- `apps/server/drizzle/0005_clean_frightful_four.sql`,
  `drizzle/meta/0005_snapshot.json`, `drizzle/meta/_journal.json` — generated.
- `apps/server/src/app.ts` — mount the routes, build the gateway client from
  the config, inject test doubles through `AppDependencies.ais`.
- `apps/server/src/xmpp/admin-client.ts` — add `unregisterUser`.
- `apps/server/src/xmpp/admin-client.test.ts` — `unregisterUser` test.
- `apps/server/src/connections/service.ts` — `countAisUsingConnection`.
- `apps/server/src/connections/routes.ts` — 409 on an in-use connection.
- `apps/server/src/connections/routes.test.ts` — 409 test.
- `work/T-0030-ais-server.md` — this Report.

**Two files outside "Allowed files"** (see problems below; both are needed by
the allowed change and are mechanical):
- `apps/server/src/test-support.ts` — added `unregisterUser` + its call log to
  `FakeAdminClient`, which `implements EjabberdAdminClient`.
- `apps/server/src/auth/cli-config.ts` — added a `unregisterUser` noop to the
  `noopAdminClient` stub, which is typed `EjabberdAdminClient`.

No changes under `apps/web/**`, `apps/mobile/**`, `packages/**`, `infra/**`,
`docs/**` or `apps/server/src/ai/**`.

### Commands run and real results

- `pnpm install`: done, no lockfile change.
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm lint`: `Found 0 warnings and 0 errors.` (308 files, 127 rules).
- `pnpm typecheck`: `Tasks: 8 successful, 8 total`.
- `pnpm exec turbo test --force`: `Tasks: 8 successful, 8 total` (uncached).
  `@galena/server`: 27 files passed, 4 skipped; **251 passed, 5 skipped**.
  This includes the new `src/ais/routes.test.ts` (14), the new admin-client
  `unregisterUser` test, and the new connections 409 test. `src/ais/integration.test.ts`
  is among the skipped files (gate not set).
- `pnpm build`: `Tasks: 2 successful, 2 total`.
- Integration test: **not run** (the spec says the lead runs it after review).

### Problems, deviations from the spec, open questions

1. **Two files outside "Allowed files" had to change, and neither is listed.**
   Adding a required `unregisterUser` to the `EjabberdAdminClient` type breaks
   every implementer that TypeScript checks, which includes the shared test fake
   (`test-support.ts`) and the CLI noop stub (`auth/cli-config.ts`). Without
   those two mechanical edits the whole repo fails `typecheck`. They are one
   method each, no behaviour change for existing tests. I judged this the
   intended, unavoidable consequence of the allowed admin-client edit rather
   than a reason to block; the lead can move them if preferred.
2. **Error codes.** The spec names only `ai_provisioning_failed` (create). For
   patch and delete failures I used `ai_update_failed` and `ai_teardown_failed`
   (both 502) so the client can tell them apart. Easy to rename.
3. **`PATCH` ordering.** External steps run before the DB write (roster rename,
   then `updateKey`, then rows), so a gateway/ejabberd failure leaves the stored
   AI unchanged. If a patch carries both a rename and a limit and `updateKey`
   fails after the roster rename succeeded, the roster nickname is briefly ahead
   of the DB; a retry fixes it. The spec did not define patch failure semantics;
   the delete/create rules are strict as specified.
4. **Redirect/redaction.** I did not call `redactSecrets` directly in the AIs
   module: the LiteLLM admin client already redacts the token id/`sk-` tokens on
   `updateKey`/`revokeKey` (it is passed the secret), `generateKey` errors cannot
   contain the not-yet-issued key, and every route failure message is a fixed
   string. Tests assert no response or log carries the fake virtual key, its id
   or the provider key. If the lead wants an explicit call in `service.ts` too,
   it is a small addition.
5. **`GET /api/ais/:id`** and the list need no gateway/cipher and still work
   when they are unconfigured; only writes answer 503 `ais_unavailable`. The
   spec did not say what to do without a configured gateway.
6. **The integration test** uses `/key/list` to find the key by its alias and
   then `/key/info?key=<token>` (the T-0007 decision note records that
   `/key/info?key_alias=` returns 404 in this pinned version). If that pinned
   `/key/list` response shape differs, the lead will see it on the first live
   run; the env vars it needs are listed at the top of the file.
7. `numeric(12,2)` money is stored as a string by Drizzle; the service converts
   with `Number()` and `toFixed(2)`.

### Blocked / needs a decision

- (none — status is review)

---

## Review (written by Claude)

**Verdict:** Round 1: changes requested

Verified by the lead: scope (see finding 3), `format:check`, `lint`, `typecheck`,
`build` pass. The test run on this machine was not usable (load average 96–166 from a
parallel Xcode build: every failure was a timeout, in files this task does not touch);
the lead re-runs the full suite after round 2. The design is right: rows start
`disabled`, compensation runs in reverse, messages are fixed strings, and the key is
sealed with the T-0028 cipher.

### Findings
1. **A partly failed delete can never be retried.** `deleteAi` revokes the key first.
   If a later step fails (ejabberd down), the AI stays, which is right, but the retry
   calls `revokeKey` on a key LiteLLM already deleted, `revokeKey` throws (it checks
   `deleted_keys`), and the AI is stuck forever. The same happens to an AI left
   `disabled` by a crash mid-create. Make teardown **resumable**; each step skips work
   that is already done:
   - after `revokeKey` succeeds, delete the `llm_virtual_keys` row straight away, so a
     retry sees no key and skips the revoke;
   - before `unregisterUser`, check `userExists` and skip it if the account is gone;
   - for the two roster items, check `getRoster` and skip an item that is not there.
   Tests: (a) delete fails at the roster step, the retry succeeds, and `revokeKey` was
   called exactly once in total; (b) a `disabled` AI with no key row and no XMPP
   account (the crash case) can be deleted.
2. **`PATCH limits` leaves `llm_virtual_keys.budget_usd` stale.** The transaction
   updates `ai_limits` only. Update `budget_usd` in the same transaction. Extend the
   existing `PATCH limits` test to assert the new value.
3. *(No change needed.)* The one-line stubs in `test-support.ts` and
   `auth/cli-config.ts` are forced by the allowed `unregisterUser` change; the spec
   should have listed them. Accepted.
4. *(No change needed.)* `ai_update_failed` / `ai_teardown_failed`, reads working
   without a gateway, the `PATCH` ordering note, and relying on the LiteLLM client's
   redaction: all accepted as reported.

The lead runs `GALENA_AIS_INTEGRATION=1` against a server from this branch after round 2.
Do not start a server yourself.
