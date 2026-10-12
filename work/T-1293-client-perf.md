---
id: T-1293
title: "Client perf: presence and occupant events don't rebuild the chats array when nothing changed (PERF-7); polls don't double up on focus and roster bursts (PERF-11); the id ledger drops ids of pruned messages (PERF-13); tested"
status: todo
milestone: M5
branch: task/T-1293-client-perf
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1293: Client perf batch

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md`:
- **PERF-7** (P2, `:61`): `handlePresence` and `handleOccupants` (`packages/client-core/src/store/incoming.ts`) do `chats: state.chats.map(...)`, a new array on every presence or occupant event, which re-renders every `state.chats` subscriber.
- **PERF-11** (P2, `:124`): two 60 s polls while visible (`/api/chats` and the open chat's pins), both re-run on every focus, plus `scheduleChatsRefresh` on every roster push (`packages/client-core/src/store/polling.ts`).
- **PERF-13** (P3, `:76`): the id ledger keeps aliases, server ids, origin ids, authors and base texts for every message ever seen, cleared only by `reset()`. The audit says to prune it together with PERF-3, which is now `packages/client-core/src/store/prune.ts` (T-1278).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **PERF-7:** return the same `chats` array (and the same chat objects) when an event changes nothing visible (the same presence, the same occupant count); update only the chat that changed.
2. **PERF-11:**
   - coalesce a focus refresh with a poll that ran in the last 10 s;
   - debounce `scheduleChatsRefresh` from roster pushes to one call per 2 s burst.
   - Keep the 60 s interval.
3. **PERF-13:** when `pruneInactiveChats` drops messages, also drop their entries from the ledger maps, through a small ledger method (cite the maps).
4. **Tests** (the message pipeline), up to 3, in the nearest client-core tests:
   - an unchanged presence keeps the `chats` reference;
   - a roster burst triggers one refresh;
   - prune clears ledger entries.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (`:61-80`, `:124-134`), `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/prune.ts` and `packages/client-core/src/store/ledger.ts`.

### Allowed files
`packages/client-core/src/**/*.ts`, `packages/chat-core/src/store/*.ts`, `work/T-1293-client-perf.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
