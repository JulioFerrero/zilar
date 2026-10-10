---
id: T-0956
title: "Size split T7: apps/server/src/ais/service.ts (1,390 lines) into ais/{queries,provisioning,persona,status}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0956-split-server-ais-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0956: Split `ais/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/ais/service.ts` is 1,390 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #4 (task T7): `ais/queries.ts`, `ais/provisioning.ts`, `ais/persona.ts`, `ais/status.ts`, under `apps/server/src/`. `ais/service.ts` becomes the barrel.

`provisioning.ts` (about 790 lines in the plan's ranges) will need one more split along the plan's boundaries: LiteLLM keys versus the XMPP account lifecycle (see `split-rules.md` item 4). Skip the entry's `db/rows.ts` dedup, because it crosses files.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #4, and `apps/server/src/ais/service.ts`.

### Allowed files
`apps/server/src/ais/service.ts`, `apps/server/src/ais/queries.ts`, `apps/server/src/ais/provisioning.ts`, `apps/server/src/ais/provisioning-keys.ts`, `apps/server/src/ais/provisioning-xmpp.ts`, `apps/server/src/ais/persona.ts`, `apps/server/src/ais/status.ts`, `work/T-0956-split-server-ais-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/ais/usage.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**What I did.** Split `apps/server/src/ais/service.ts` (1,390 lines) into feature modules, following `docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.1 #4. `provisioning.ts` was split once more along the entry's named boundary (rule 4): LiteLLM keys vs the XMPP account lifecycle. `service.ts` is now a barrel that re-exports the same 30 names with the same kinds. No file outside the Allowed files was touched and no importer changed.

**Sizes (`wc -l`).**

| File | Lines |
| --- | ---: |
| `apps/server/src/ais/service.ts` (before) | 1,390 |
| `apps/server/src/ais/service.ts` (barrel) | 44 |
| `apps/server/src/ais/persona.ts` | 176 |
| `apps/server/src/ais/queries.ts` | 252 |
| `apps/server/src/ais/provisioning.ts` | 273 |
| `apps/server/src/ais/provisioning-keys.ts` | 331 |
| `apps/server/src/ais/provisioning-xmpp.ts` | 218 |
| `apps/server/src/ais/status.ts` | 176 |

Every new file and the barrel are ≤ 400 lines. New total 1,470; the +80 is one import header per new module.

**Exports before and after.** `grep -E "^export"` on `git show HEAD:apps/server/src/ais/service.ts` lists 30 names; the barrel lists the same 30 (same kinds), none added or removed. A set comparison reported `old count 30, barrel count 30, only in old (none), only in barrel (none)`.

Old list (also the barrel's): `ActiveAiForGateway, AiLifecycleEvent, AiLimits, aiLocalpart, AiLogger, AiServiceDeps, assignMachine, AssignMachineInput, changeAiModel, ChangeAiModelInput, CHAT_PERSONA_MAX_LENGTH, createAi, CreateAiInput, deleteAi, ensureAiModel, findOwnedAi, getOwnedAi, listActiveAisForGateway, listAis, MAX_MONTHLY_USD, onAiLifecycle, PublicAi, resumeAi, revertPersonaFromChat, setPersonaFromChat, stopAi, updateAi, UpdateAiInput, VIRTUAL_KEY_BUDGET_DURATION, virtualKeyAlias`.

The new modules additionally export helpers that were private before, so sibling modules can share them; the barrel does **not** re-export them, so the public surface is unchanged: `queries.ts` (`emitAiLifecycle`, `findAiForGateway`, `findGatewayAiEffect`, `toPublicAi`), `persona.ts` (`resolvePersona`, `provisioningFailed`, `updateFailed`, `teardownFailed`), `provisioning-keys.ts` (`deleteModelsNamed`, `withAiEnsureLock`, `ENSURE_MODEL_LOCK_SCOPE`), `provisioning-xmpp.ts` (`compensateCreate`).

**Dedup.** Both of the entry's dedup items cross files, so rule 2 defers them to a separate F task and I kept them as-is: the `toPublicAi`/`PublicAiRow` → `db/rows.ts` fold (the spec says to skip it) and the `provisioningFailed`/`updateFailed`/`teardownFailed` → `errors.ts` constructors (§2.8, `errors.ts` is outside the Allowed files).

**Effect ratchet.** No `// effect-plain:` markers were needed: every new module imports `effect` as a value (it runs `Effect.gen`), so its kind is `effect`; the barrel is `plain`. The gate's `effect` step passed.

**Commands run.**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage.test.ts` → `1 passed (1)` files, `13 passed (13)` tests.
- `pnpm exec tsc --noEmit` in `apps/server` → clean (no output).
- `pnpm exec prettier --write` on the 7 changed files → all formatted.
- `pnpm gate` → summary below.

**Gate summary.**
```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.9s)
PASS  lint  (0.9s)
PASS  typecheck  (3.0s)
PASS  effect  (1.2s)
PASS  tests @zilar/server  (6.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Files changed.** The 7 `apps/server/src/ais/*.ts` files plus this task file.

**Deviations / notes.** Line ranges are a reading aid, so a few small helpers drifted from the entry's ranges: `resolvePersona` went to `persona.ts`; `usd` and `findUserName` went to `provisioning.ts`. Behaviour is unchanged (code moved verbatim, only imports and `export` keywords added). `stopAi`/`resumeAi`/`assignMachine` are in `status.ts` as the entry lists (700–869); `deleteAi` and `compensateCreate` are in `provisioning-xmpp.ts` as the XMPP-account teardown/rollback side, and the LiteLLM model/key functions (`ensureAiModel`, `changeAiModel`, `registerModelWithKey`, `deleteModelsNamed`, the ensure lock) are in `provisioning-keys.ts`.

**Blocked / needs a decision.** None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The split:** `ais/service.ts` (1,390 lines) splits into `queries`, `provisioning` (with `provisioning-keys` beside it), `persona` and `status`; the largest is `provisioning-keys.ts` at 331.
- **No change for importers:** the export surface is identical.
- **Check:** the 13 kept tests pass, and so does the gate.
