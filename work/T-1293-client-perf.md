---
id: T-1293
title: "Client perf: presence and occupant events don't rebuild the chats array when nothing changed (PERF-7); polls don't double up on focus and roster bursts (PERF-11); the id ledger drops ids of pruned messages (PERF-13); tested"
status: merged
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

status: review

### What I did

Rechecked all three findings on this branch first; all three were still present, no
skips.

- **PERF-7** (`incoming.ts`): `handlePresence` and `handleOccupants` now update the
  chat list through a functional `set` that returns `state` itself when nothing
  visible changed (same `online`/`onlineCount`/`memberCount`, so the store skips the
  update and every chat-list subscriber is untouched), and `slice()`s the array to
  replace only the one chat that changed. `handlePresence` grew a small
  `chatAfterPresence` helper; a repeated stamped unavailable compares the instant,
  so it does not re-stamp `lastSeenAt`.
- **PERF-11** (`polling.ts`, `lifecycle.ts`): added a `refreshGate` so a focus
  refresh is dropped when a poll ran less than `CHAT_REFRESH_COALESCE_MS` (10 s)
  ago, for both the chat-list and the pins loops; the 60 s intervals are unchanged.
  Added `scheduleChatsRefreshBurst`, which refreshes on the first roster/invitation/
  removal push and ignores the rest for `ROSTER_REFRESH_DEBOUNCE_MS` (2 s) via a
  store-scoped timer. `lifecycle.ts`'s three push listeners now call it.
- **PERF-13** (`ledger-ids.ts`, `ledger.ts`, `prune.ts`): added the ledger method
  `forgetMessages(chatId, ids)`, which drops the dropped messages' entries from the
  six maps named in `LedgerMaps` (`aliases`, `serverIds`, `originIds`,
  `originClaims`, `authors`, `baseTexts`), including the aliases pointing at a
  pruned root. `pruneInactiveChats` calls it with the ids leaving
  `messagesByChat`.
- **Tests** (3, as listed): `incoming-presence.test.ts` (new file; `incoming.test.ts`
  is already 425 lines, over the 400-line cap, so I did not grow it) — unchanged
  presence and occupant bursts keep the `chats` reference and the unchanged chat
  objects; `polling.test.ts` — a roster burst calls `scheduleChatsRefresh` once, and
  again after the 2 s window; `prune.test.ts` — prune clears the dropped message's
  ledger entries (author, base text, origin target, maps) and keeps the kept
  message's.

### Files changed

- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/polling.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/ledger-ids.ts`
- `packages/client-core/src/store/ledger.ts`
- `packages/client-core/src/store/prune.ts`
- `packages/client-core/src/store/incoming-presence.test.ts` (new)
- `packages/client-core/src/store/polling.test.ts`
- `packages/client-core/src/store/prune.test.ts`
- `work/T-1293-client-perf.md`

### Commands and results

- `pnpm install` — done.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/polling.test.ts src/store/prune.test.ts src/store/incoming-presence.test.ts` — 3 files, 12 tests passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts src/store/lifecycle.test.ts src/store/ledger.test.ts` — 3 files, 52 tests passed.
- `pnpm gate` — `PASS install (frozen) / format / lint / typecheck / effect / tests @zilar/client-core`, then `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `GATE PASS`. 10 changed files.

Line counts of changed files are all ≤ 400 (`lifecycle.ts` was 398 lines on `main`
and 400 after my change; no file passed the cap).

### Deviations / notes

- Tests are the 3 named in the spec, so the focus-coalescing gate has no dedicated
  test; it is exercised by the existing interval/focus test and typechecked.
- No dependencies added; no files outside Allowed files.

### Round 1 (fix round)

Findings fixed:

- **Finding 1** (should-fix, `packages/client-core/src/store/polling.ts:96-109`):
  deleted the unused `RefreshGate.run` member and its implementation. Both loops
  call only `ifStale`, and a repo search confirmed nothing else referenced `run`.
  No behaviour change.
- **Finding 2** (nit, `prune.test.ts`) and **Finding 3** (nit, `ledger-ids.ts`):
  left as they are, per the rule to touch nits only in a line I already change;
  neither file is part of this round's edit.

Tests added: none. Finding 1 is dead-code removal, not a behaviour change, and it
names no test. The existing `polling.test.ts` focus/interval cases still cover the
gate.

Commands:

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/polling.test.ts`
  — 1 file, 8 tests passed.
- `pnpm gate` — `PASS install (frozen) / format / lint / typecheck / effect / tests
  @zilar/client-core`, `scope: every changed file is inside the Allowed files`,
  `migration: every added migration continues from the base`, `GATE PASS`. 10 changed
  files.

status stays `review`.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits).**
- **Lead's checks after the rebase:**
  - client-core vitest: 12 files, 139 tests pass. Run on their own, the PERF-7, PERF-11 and PERF-13 cases pass (`incoming-presence.test.ts`, `polling.test.ts` roster burst, `prune.test.ts` ledger entries);
  - tsc: 0 errors in client-core, web and mobile;
  - `incoming.ts` is 319 lines and `polling.ts` 279.
