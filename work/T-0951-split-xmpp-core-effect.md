---
id: T-0951
title: "Size split T9: packages/xmpp-core/src/core-effect.ts (1,206 lines) into core-effect/{config,lifecycle,presence,stanza-router,operations}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0951-split-xmpp-core-effect
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0951: Split `core-effect.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/xmpp-core/src/core-effect.ts` is 1,206 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #6 (task T9 in §4.2): `core-effect/config.ts`, `core-effect/lifecycle.ts`, `core-effect/presence.ts`, `core-effect/stanza-router.ts`, `core-effect/operations.ts`, under `packages/xmpp-core/src/`. `core-effect.ts` becomes the barrel.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #6, and `packages/xmpp-core/src/core-effect.ts`.

### Allowed files
`packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/core-effect/stanza-router.ts`, `packages/xmpp-core/src/core-effect/operations.ts`, `work/T-0951-split-xmpp-core-effect.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot src/connection-resilience.test.ts src/stream-management.test.ts src/mam.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
