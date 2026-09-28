---
id: T-0007
title: Spike S5 — LiteLLM virtual keys with hard budgets, and adding a user's own provider key (BYOK)
status: todo
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
-

### The verdict
**Can LiteLLM issue hard-capped virtual keys and hold a user's own provider key?**
Yes / No / Yes with caveats
-

### Budget enforcement evidence
-

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:
- integration run:

### Problems, deviations from the spec, open questions
-

### What the M2 gateway task has to do
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
