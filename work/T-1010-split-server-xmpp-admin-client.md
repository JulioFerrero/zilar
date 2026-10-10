---
id: T-1010
title: "Size split T71: apps/server/src/xmpp/admin-client.ts (539 lines) into xmpp/admin/{schemas,types,errors,client}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-1010-split-server-xmpp-admin-client
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1010: Split `xmpp/admin-client.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/xmpp/admin-client.ts` is 539 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #67 (task T71): `xmpp/admin/schemas.ts`, `admin/types.ts`, `admin/errors.ts`, `admin/client.ts`, under `apps/server/src/`. `xmpp/admin-client.ts` becomes the barrel; `apps/server/src/test-support.ts` imports from it and must keep working unchanged.

Move the code unchanged, and skip the Dedup, because it crosses files. This client creates XMPP accounts and rooms, so not one line of its logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #67, and `apps/server/src/xmpp/admin-client.ts`.

### Allowed files
`apps/server/src/xmpp/admin-client.ts`, `apps/server/src/xmpp/admin/schemas.ts`, `apps/server/src/xmpp/admin/types.ts`, `apps/server/src/xmpp/admin/errors.ts`, `apps/server/src/xmpp/admin/client.ts`, `work/T-1010-split-server-xmpp-admin-client.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
