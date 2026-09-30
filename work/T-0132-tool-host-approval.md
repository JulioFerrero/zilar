---
id: T-0132
title: Approve a tool's hosts once, before it can reach the network
status: in-progress
milestone: M4
branch: task/T-0132-tool-host-approval
model: meta/muse-spark-1.3-contributor
depends_on: [T-0105, T-0116]
estimate: 1 day
---

# T-0132: Approve a tool's hosts once, before it can reach the network

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-09-30: an AI-built tool's hosts are **approved once per tool** by a human. Today `tool.save` and `tool.run` are tier 1 (no card), and `runToolVersion` gives the sandbox `allowedHosts: versionRow.hosts` (`apps/server/src/tools/service.ts` around line 636), i.e. the hosts the AI itself declared. An AI could save a tool that sends data to any host it names, and test-run it in the same turn, with no human step. `routine.schedule` (tier 2) already shows the hosts on a card, but a manual or AI run does not go through it. Close that gap **before `TOOLS_ENABLED` is ever turned on**.

### Behavior
1. A tool has an approved host set (`approved_hosts`, per tool, default empty). The sandbox may only contact `declared hosts ∩ approved hosts` for EVERY run trigger (`ai`, `user`, `routine`). A tool with no approved hosts still runs, with no network.
2. New adapter `tool.approve_hosts` (tier 2, a card in the topic): "Allow the tool <name> to contact: <hosts>". Args: tool name only; the hosts shown on the card are read from the tool's CURRENT version (never from model text). On approval the tool's `approved_hosts` becomes exactly those hosts. Fail safe like `routine.schedule` does: if the current version's hosts changed between the card and the execution, do nothing and fail.
3. Saving a new version whose declared hosts are a subset of the approved set needs no card. A version that declares any host outside the approved set keeps working without that host (no network for it) until a new `tool.approve_hosts` is approved; the tool result text the model receives says which hosts are not approved yet, so it can ask. Never expand `approved_hosts` automatically. Approval is per tool in its (AI, topic) scope, revocable (a `tool.revoke_hosts` action, tier 1, empties the set) and audited (ids and host names in audit detail are fine; never code or output).
4. `routine.schedule` keeps its own card and per-routine `approvedHosts`, but it must now also require every host on its card to be inside the tool's approved set (else `failed`, model told to run `tool.approve_hosts` first). An existing routine keeps working: on migration, set each tool's `approved_hosts` to the union of `approved_hosts` of its live routines (there are none in production yet; the code path must still be correct).
5. The card must show the hosts exactly as they will be matched (exact hostnames, no wildcards), reusing the existing host validation/normalization (`toolHostsSchema`).

### Data
Column `approved_hosts jsonb not null default '[]'` on the tools table. Migration only via `pnpm --filter @galena/server db:generate`. This is a schema task: it starts only after T-0116 has merged (one schema task at a time).

### Read first
`AGENTS.md`, `docs/TOOL_SANDBOX.md`, `apps/server/src/tools/{adapters,service,schemas,types}.ts`, `apps/server/src/actions/registry.ts`, `work/T-0105-tool-adapters.md` (Review), `work/T-0104-routines-scheduler.md`.

### Allowed files
`apps/server/src/tools/**`, `apps/server/src/routines/**` (only the host check in schedule/execute), `apps/server/src/db/schema.ts` + the migration, `apps/server/src/actions/**` only if a new tier-2 card needs registration, `docs/TOOL_SANDBOX.md`, `docs/SERVER_CONFIG.md` (if needed), `work/T-0132-tool-host-approval.md`. No web or mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm build
```

### Acceptance criteria
- [ ] With empty `approved_hosts`, a tool whose source calls `fetch` to a declared host gets a network refusal from the sandbox for `ai`, `user` and `routine` runs (test each trigger).
- [ ] `tool.approve_hosts` card lists hosts read from the DB, not from the model; approving sets the set; a host change between card and execution fails safe (test).
- [ ] A new version with an extra host does not reach it until re-approved; the model text names the unapproved host (test).
- [ ] `routine.schedule` rejects hosts outside the tool's approved set; existing behavior otherwise unchanged (test).
- [ ] `tool.revoke_hosts` empties the set and is audited without code or output (test).
- [ ] No tool source, hosts list beyond names, or output in logs or audit detail (test).

### Out of scope
UI (T-0107 shows approved hosts later), changing the tier of `tool.save`/`tool.run`, wildcard hosts.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
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
