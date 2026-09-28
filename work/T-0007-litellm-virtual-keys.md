---
id: T-0007
title: Spike S5 — LiteLLM virtual keys with hard budgets, and adding a user's own provider key (BYOK)
status: review
milestone: M2
branch: task/T-0007-litellm-virtual-keys
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0002]
estimate: 1 day
---

# T-0007: Spike S5 — LiteLLM virtual keys and BYOK

## Spec (written by Claude, do not edit)

### Goal
M2 needs an LLM gateway that holds the real provider keys and hands each AI a
**capped placeholder key** (`docs/PROJECT_PLAN.md` §"Keys" and the decisions
table: "Real keys live only in the platform's LLM gateway (LiteLLM), and desks
only get capped placeholder keys").

This spike answers, against the **running** LiteLLM: can we issue a virtual key
per AI with a hard spend cap, prove the cap is actually enforced, and add a
user's own provider key, without a real key ever reaching a client? The verdict
decides the design of the M2 gateway, so answer it with evidence, not opinion.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`: the "Keys" row in the decisions table, the
  "LLM gateway" decision, and §"Decryption happens only inside the LLM gateway"
- `infra/litellm/config.yaml` and the `litellm` service in
  `infra/docker-compose.dev.yml` (pinned by digest, **1.102.1**)
- `apps/server/src/config.ts` (zod config loading) and `apps/server/src/db/**`
  (Drizzle + migrations, PGlite in tests)
- The security notes in the plan: virtual keys with hard caps, encrypted storage,
  "desks get a virtual key per AI that works only through the platform"

### Allowed files
- `apps/server/src/ai/**` (new module)
- `apps/server/src/config.ts` — **only** to add new env entries
- `apps/server/src/db/**` — only if a migration is genuinely needed
- `pnpm-lock.yaml`
- `work/T-0007-litellm-virtual-keys.md`

**Not allowed:** `infra/**` (the dev stack is running and Julio is using it),
`apps/mobile/**`, `apps/web/**`, `packages/**`, `docs/**`. If you need a change
there, describe it in the Report and stop.

> Another worker (T-0004) is also editing `pnpm-lock.yaml` right now. Do not try
> to resolve a lockfile conflict; the lead does that at merge time.

### Allowed dependencies
None. `apps/server` already has everything needed (`fetch`, `zod`, `drizzle`).

### What to build
1. **A thin LiteLLM admin client** in `apps/server/src/ai/`: issue a virtual key
   with a budget, read a key's info, update its cap, and revoke it. Use
   LiteLLM's `/key/generate`, `/key/info`, `/key/update`, `/key/delete` with the
   master key. Validate every response with `zod` — this is a network boundary.
2. **The budget must be a hard cap.** Set `max_budget` (and a `tpm_limit` or
   `rpm_limit` if the version supports it) and then **prove enforcement**: make
   a call that exceeds the cap and show that LiteLLM rejects it. Paste the real
   responses.
3. **BYOK: adding a user's own provider key.** Show the exact `model_list` entry
   that registers a user's provider key, and how a user's key is kept separate
   from the platform's. **No real provider key exists in this repo**, so prove
   the mechanism against the existing `placeholder` model and say plainly in the
   Report that a real-provider round trip is still unproven.
4. **Secrets stay server-side.** The master key comes from the environment
   (`LITELLM_MASTER_KEY`), is read through the existing zod config, and must
   never be returned by an API route, logged, or included in an error message.
   Tests:
   - the client sends the master key in the expected header and nowhere else
   - an error from LiteLLM does not leak the master key or any provider key
   - a route that hands a virtual key to a client returns only the key string
     and its id, never the master key
5. **A decision note** in the Report: where virtual keys are stored, when they
   are rotated, and what happens when a cap is hit mid-run.

### Integration check (you run it against the running stack)
LiteLLM is **already running and healthy** on `127.0.0.1:4000`. A script or a
test gated by `GALENA_LITELLM_INTEGRATION=1` that:
- issues a virtual key with a tiny budget
- calls the proxy with it
- shows the call succeeding, then the cap being enforced
- revokes the key and shows it stops working

**Never** run `pnpm infra:up`, `infra:down` or `infra:reset`, and never restart or
stop LiteLLM, Postgres or anything else. A copy of `infra/.env` is in your
worktree: use it as it is, never print its values, never look outside the
worktree. Clean up any virtual keys you create.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] Every test named above exists and passes, with a fake `fetch`.
- [ ] The integration output is pasted in the Report, including the cap being
      enforced.
- [ ] The Report ends with a clear **yes/no** on whether the gateway design in
      the plan is feasible as written, plus anything that surprised you.
- [ ] Only allowed files touched. The running stack was never stopped or reset.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Any AI, desk, listener or chat integration. This is only the gateway's key and
  budget mechanics.
- Real provider keys, real spend, and any account or billing surface.
- Changing `infra/litellm/config.yaml` or the compose file.

---

## Report (written by the worker when done)

### What I did

- Added a new module `apps/server/src/ai/`:
  - `litellm-client.ts` — a typed admin client for LiteLLM 1.102.1:
    `key/generate`, `key/info`, `key/update`, `key/delete`. Every request sends
    `Authorization: Bearer <master key>` and nothing else carries it; every
    response is validated with `zod` (network boundary). Errors are wrapped in
    `LitellmApiError` and redacted, so no message can echo the master key or a
    provider key.
  - `model-entry.ts` — BYOK helper that turns a user's provider key into the
    exact `model_list` entry (one model group per AI, so a user key never shares
    a group with a platform model).
  - `routes.ts` — `POST /api/ai/virtual-keys` (session-gated): takes a model
    list and optional caps, returns **only** `{ id, key }`.
  - `integration.ts` — the live-stack spike script, gated by
    `GALENA_LITELLM_INTEGRATION=1`.
  - `*.test.ts` — Vitest unit/route tests with a fake `fetch`.
- `apps/server/src/config.ts` — added two **optional** env entries:
  `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY`. No migration: key records are not
  stored in our DB yet (see the decision note) and would need `ais`, which does
  not exist.

### The verdict

**Can LiteLLM issue hard-capped virtual keys and hold a user's own provider key?**

**Yes, with caveats.** Virtual keys with a hard `max_budget` (plus `budget_duration`,
`tpm_limit`, `rpm_limit`, model allowlist, expiry) are issued and enforced
against the running proxy. Holding and using a user's own provider key works, but
in this pinned image the *DB-backed* registration of a model with a user key is
off (`store_model_in_db` is not set), so the M2 gateway must run its own config
file with that flag — a change under `infra/**` that is outside this task.

### Budget enforcement evidence

Live run, `GALENA_LITELLM_INTEGRATION=1` against `127.0.0.1:4000` (8/8 checks):

```
health: HTTP 200 "I'm alive!"
PASS  proxy is reachable

-- issue a virtual key (galena-t0007-1790554558276) with a 0.01 USD hard cap --
issued: id=34c6a7e8...a33c6e57 key=sk-*** maxBudget=0.01 models=placeholder
PASS  key is issued with the cap stored
key info: spend=0 maxBudget=0.01 tpm=100 rpm=60
PASS  cap and rate limits are readable

-- call the proxy with the virtual key --
GET /v1/models: HTTP 200 {"data":[{"id":"placeholder","object":"model","created":1677610602,"owned_by":"openai"}],"object":"list"}
PASS  the virtual key authenticates and completes a proxy call
POST /chat/completions: HTTP 401 {"error":{"message":"litellm.AuthenticationError: AuthenticationError: OpenAIException - Incorrect API key provided: sk-****3456. ... Received Model Group=placeholder
PASS  the proxy forwards the call to the configured provider

-- BYOK: a user-supplied provider key is used instead of the platform key --
with api_key override: HTTP 401 {"error":{"message":"litellm.AuthenticationError: AuthenticationError: OpenAIException - Incorrect API key provided: sk-***-key. ...
user key forwarded: true | platform key reused: false
PASS  LiteLLM forwards the user key, not the platform placeholder key

-- hard cap: spend above max_budget is rejected --
over cap: HTTP 429 {"error":{"message":"Budget has been exceeded! Key=galena-t0007-1790554558276 (sk-...vPvg) Current cost: 0.02, Max budget: 0.01","type":"budget_exceeded","param":null,"code":"429"}}
PASS  the cap is enforced: the call is rejected with budget_exceeded

-- revoke: the key stops working --
after revoke: HTTP 401 {"error":{"message":"Authentication Error, Invalid proxy server token passed. Received API Key = sk-...vPvg, ...
PASS  a revoked key is rejected

-- BYOK registration probe (/model/new), informational --
/model/new: HTTP 500 {"error":{"message":"{'error': \"Set `'STORE_MODEL_IN_DB='True'` in your env to enable this feature.\"}","type":"auth_error","param":"None","code":"500"}}

8/8 checks passed
```

The cap was proven without a real provider: the integration script first
succeeds with a `1d` / $0.01 key, then (admin-only) sets the key's `spend` to
$0.02 above the $0.01 `max_budget`. The very next call is refused with
`budget_exceeded` *before* it reaches the provider, which is exactly the
pre-flight enforcement M2 needs. A second, independent proof used only public
API: `max_budget: 0` on a fresh key -> `429 Budget has been exceeded! Current
cost: 0.0, Max budget: 0.0`.

One thing worth repeating from the raw output: the mono-provider `placeholder`
model answers `401` from OpenAI. That is *not* a virtual-key failure — the key
authenticated (proxy-level) and LiteLLM forwarded the request to the configured
provider, which rejected the fake key. Only the successful proxy-level call
(`GET /v1/models`) and the `429` cap rejection are key-level proofs; a real 200
completion is out of scope because **no real provider key exists in this repo**.

### Files changed

- `apps/server/src/ai/litellm-client.ts` (new)
- `apps/server/src/ai/litellm-client.test.ts` (new, 14 tests)
- `apps/server/src/ai/model-entry.ts` (new)
- `apps/server/src/ai/model-entry.test.ts` (new, 5 tests)
- `apps/server/src/ai/routes.ts` (new)
- `apps/server/src/ai/routes.test.ts` (new, 4 tests)
- `apps/server/src/ai/integration.ts` (new)
- `apps/server/src/config.ts` (added `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY`)
- `work/T-0007-litellm-virtual-keys.md` (this Report)

No migration, no lockfile change, nothing under `infra/**`, `apps/web`,
`apps/mobile`, `packages/**` or `docs/**`.

### Commands run and real results

- `pnpm install`: done, 904 resolved / 877 reused, no lockfile change.
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm lint`: `Found 0 warnings and 0 errors.` (242 files, 127 rules)
- `pnpm typecheck`: `Tasks: 8 successful, 8 total`.
- `pnpm test`: `Tasks: 8 successful, 8 total`; `@galena/server` 19 files,
  **178 passed** (includes the 23 new `src/ai` tests).
- `pnpm build`: `Tasks: 2 successful, 2 total` (only packages with a build
  script; `@galena/server` has no build script).
- integration run: `GALENA_LITELLM_INTEGRATION=1 pnpm --filter @galena/server exec
  tsx --env-file=<repo>/infra/.env src/ai/integration.ts` -> **8/8 checks passed**,
  exit 0. The virtual key was revoked in a `finally` block; the temp keys I used
  while probing were all deleted.

### Decision note (required by the spec, item 5)

**Where virtual keys are stored.** The plan's `llm_virtual_keys`
(`ai_id, litellm_key_id, budget, duration`) is the right home, and the installed
version supports storing **only the LiteLLM token id**, never the key string:
`GET /key/info?key=<token_id>` returns the full key record (verified live,
`200`), while `?key_alias=...` does not work (`404`). So the server can read cap,
spend and status later by id without holding a usable credential. Do **not**
store the `sk-...` string client-side; hand it over once, like an API token.

**When they are rotated.** Rotation by re-issuing is the only option here:
`POST /key/{id}/regenerate` and the auto-rotation fields (`auto_rotate`,
`rotation_interval`) are **Enterprise** — the live call returned
`500 "Regenerating Virtual Keys is an Enterprise feature"`. So rotation =
`/key/delete` old + `/key/generate` new, then update the row. `auto_rotate`
appears in `/key/info` but is not usable without a license.

**When a cap is hit mid-run.** LiteLLM refuses the next request pre-flight with
`HTTP 429 budget_exceeded`. With `budget_duration` set, the spend resets at
`budget_reset_at` (observed: a `30d` key reset at the 1st of the month). The
plan's "AI stops at 100%" can therefore be modelled as a 429 from the gateway;
the M2 gateway task should map that to a room warning/stop and should reserve
budget before a run so a loop cannot overshoot inside one turn.

**BYOK specifics.** A user key is registered as its own `model_list` entry (one
group per AI). The spike proved LiteLLM prefers a user key over the platform's:
the proxied provider error echoed the user's key, never the platform's
placeholder. Two caveats: only the provider-appropriate key (e.g. an OpenAI key
for an OpenAI model) works, and `general_settings.store_model_in_db` must be set
for `/model/new`; changing the config file or the compose env is out of scope
here.

### Problems, deviations from the spec, open questions

- **A real-provider round trip is still unproven.** No real provider key exists,
  so the success path was proven at the proxy level (`/v1/models` 200) plus the
  provider-error path; the first real 200 completion will happen when a real key
  is added.
- **`store_model_in_db` is not set** in the pinned config, so `/model/new`
  returns 500. The M2 gateway change under `infra/**` is described in the
  decision note; per the spec I did not touch `infra/**`.
- **The `spend` override.** I used `/key/update` with `spend` to cross a cap
  without a real provider. This is an admin API and is called out in the
  `UpdateVirtualKeyInput.spend` doc comment as spike-only; it is not used by the
  app to fabricate user spend.
- **`LITELLM_MASTER_KEY` is optional in `config.ts`.** The task says the master
  key must come through the zod config. Making it required would have broken
  every existing test fixture, so it is optional at the config layer and
  `createLitellmAdminClientFromConfig` throws `LITELLM_MASTER_KEY is not
  configured` when it is absent. If the lead prefers it required in production,
  that is a one-line change plus fixtures.
- **The route is mounted in tests only.** Wiring `createAiRoutes` into
  `app.ts`/`index.ts` is a product decision after the spike verdict; per the
  spec (no AI/desk integration) the module exports the route factory and the M2
  task mounts it.

### What the M2 gateway task has to do

- Create the `ais` and `llm_virtual_keys` tables (`ai_id`, `litellm_key_id`,
  `budget`, `duration`, `status`) and treat the key string as one-time.
- Wire `createLitellmAdminClientFromConfig(config)` into `index.ts` (fail fast
  when the master key is missing) and mount `createAiRoutes`.
- Add `store_model_in_db: true` to `infra/litellm/config.yaml` (or the compose
  env) and call `/model/new` (via an `addModel` client method) when a user key
  is saved; keep on-demand config + reload as the fallback.
- Reserve budget before each AI run and map `429 budget_exceeded` to a room
  warning / stop + `ledger_entries`.
- Set `LITELLM_BASE_URL`/`LITELLM_MASTER_KEY` in the server env for dev.

### Blocked / needs a decision

- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
