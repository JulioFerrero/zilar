---
id: T-0030
title: M2 — AIs on the server: profiles, their own XMPP account, a capped LiteLLM virtual key
status: todo
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
-

### Files changed
-

### Commands run and real results
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)
