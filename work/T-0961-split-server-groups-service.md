---
id: T-0961
title: "Size split T5+T6: apps/server/src/groups/service.ts (1,583 lines) into groups/{schemas,members,ais,queries}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0961-split-server-groups-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0961: Split `groups/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/groups/service.ts` is 1,583 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T5, T6); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #3: `groups/schemas.ts`, `groups/members.ts`, `groups/ais.ts`, `groups/queries.ts`, under `apps/server/src/`. `groups/service.ts` becomes the barrel.

`members.ts` comes to about 450 lines in the plan's ranges. Split it once more into `members.ts` (membership and roles) and `invites.ts` (invites), following `split-rules.md` item 4.

Skip the entry's cross-file Dedup (`groups/access.ts`), which is task F5. This is permissions code (membership and roles), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #3, and `apps/server/src/groups/service.ts`.

### Allowed files
`apps/server/src/groups/service.ts`, `apps/server/src/groups/schemas.ts`, `apps/server/src/groups/members.ts`, `apps/server/src/groups/invites.ts`, `apps/server/src/groups/ais.ts`, `apps/server/src/groups/queries.ts`, `work/T-0961-split-server-groups-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/groups/visibility.test.ts src/roles/roles.test.ts src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
