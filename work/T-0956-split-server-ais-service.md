---
id: T-0956
title: "Size split T7: apps/server/src/ais/service.ts (1,390 lines) into ais/{queries,provisioning,persona,status}.ts, the old path a barrel"
status: todo
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

## Review (written by Claude)
