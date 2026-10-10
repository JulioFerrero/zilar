---
id: T-1027
title: "Size split T94: packages/devtools/src/xmpp-e2e.ts (457 lines) into xmpp-e2e/{harness,connect,muc,mam,main}.ts; one withDeadline"
status: todo
milestone: M5
branch: task/T-1027-split-devtools-xmpp-e2e
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1027: Split `xmpp-e2e.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/xmpp-e2e.ts` is 457 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #90 (task T94). The new files go in a new `packages/devtools/src/xmpp-e2e/` folder: `harness.ts`, `connect.ts`, `muc.ts`, `mam.ts` and `main.ts`.

`packages/devtools/src/xmpp-e2e.ts` stays the entry, because `packages/devtools/package.json:8` runs `tsx src/xmpp-e2e.ts`. It keeps the header comment and starts the run.

- **In scope:** the in-file Dedup. One `withDeadline(timeoutMs, onTimeout)` replaces the settled-and-timeout boilerplate in `connect`, `waitForPresence` and `queryRoomMam`. Each keeps its own timeout value and error text.
- **Out of scope:** the `xmppErrorCondition` → xmpp-core item, because it crosses packages.

The run needs the dev stack, so nobody runs it in this task.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #90, and `packages/devtools/src/xmpp-e2e.ts`.

### Allowed files
`packages/devtools/src/xmpp-e2e.ts`, `packages/devtools/src/xmpp-e2e/harness.ts`, `packages/devtools/src/xmpp-e2e/connect.ts`, `packages/devtools/src/xmpp-e2e/muc.ts`, `packages/devtools/src/xmpp-e2e/mam.ts`, `packages/devtools/src/xmpp-e2e/main.ts`, `work/T-1027-split-devtools-xmpp-e2e.md`.

### Checks
```bash
pnpm --filter @zilar/devtools typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
