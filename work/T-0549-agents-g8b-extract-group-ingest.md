---
id: T-0549
title: "Agents G8b: move the group ingest side (sessionForAiJid, handleRoomIncoming, pumpRoom) out of createAgentGateway into agents/gateway/group-ingest.ts verbatim; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0549-agents-g8b-extract-group-ingest
model: auto
effort: low
depends_on: [T-0546]
estimate: 0.5 day
---

# T-0549: agents G8b, extract the group ingest

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G8". The lead split it in two: **G8a (T-0546) moved `runGroupSessionTurn`** into `agents/gateway/group-turn.ts`, and this task moves the ingest side. **The models to copy are G7 (`agents/gateway/dm-turn.ts`) and G8a (`agents/gateway/group-turn.ts`).** This is a pure extraction: no logic change and no Effect.

### Verified facts (do not re-derive; find each function by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move after merges)
- **The functions to move verbatim** (after G8a):
  - `sessionForAiJid(bare)` (around line 630);
  - `handleRoomIncoming(session, message)` (around 642);
  - `pumpRoom(session, roomJid)` (around 740).
- **Callers that stay:** the room-listener and `start()` wiring passes `handleRoomIncoming` or calls it. Find every caller with grep. Then destructure from the new factory so those call sites keep the same text.
- **What they close over:** `runGroupSessionTurn` (from `createGroupTurn`), the session map, `roomListener`, `budgetGate`, `logger`, `deps`, and closures such as `roomJidFor` and `nowMs`. Take closures as callbacks in `ctx`, as G7 and G8a did, using indexed-access types.
- **The order constraint:** the factory must be created after `createGroupTurn` and every value it needs. If a value `createGroupTurn` needs is defined after these functions today (function hoisting), keep `ctx` fields as arrow callbacks that read the value lazily, as G5b (`sessions.ts`, `isStarted`) did.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`): the groups block, request_action in groups, AI handoff, delegation tools, topic naming, and the listener tests (`apps/server/src/agents/listener/*.test.ts`).

### What to build
1. **Create `apps/server/src/agents/gateway/group-ingest.ts`** exporting `createGroupIngest(ctx)`. It returns the moved functions that callers in `gateway.ts` still use.
2. **In `createAgentGateway`:**
   - create it once;
   - destructure;
   - remove the moved functions and drop the imports that only they used.
3. **Move the bodies verbatim:** no logic edits and no renames. Put a whitespace-insensitive diff of the old block against the new one in the Report; only the factory wrapper may differ.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G8", `apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `work/T-0549-agents-g8b-extract-group-ingest.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The group ingest lives in `agents/gateway/group-ingest.ts`, moved verbatim, with the diff in the Report.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Pure extraction, zero behaviour change. `sessionForAiJid`, `handleRoomIncoming`
and `pumpRoom` moved verbatim from `createAgentGateway` into the new
`apps/server/src/agents/gateway/group-ingest.ts` (`createGroupIngest(ctx)`),
modelled on G7 (`dm-turn.ts`) and G8a (`group-turn.ts`).

What I did:
- Created `apps/server/src/agents/gateway/group-ingest.ts` exporting
  `createGroupIngest(ctx)`. `ctx` carries `deps`, `logger`, the shared
  `sessions` / `roomRounds` maps, `noteListenerMessage` (taken from the
  `roomListener` instance), `secretsFor`, and `runGroupSessionTurn`.
- In `gateway.ts`: create the ingest factory once (before `createGroupTurn`),
  destructure `{ sessionForAiJid, handleRoomIncoming, pumpRoom }`, and removed
  the three moved functions. `createGroupTurn` now receives
  `sessionForAiJid: (bare) => sessionForAiJid(bare)`; the ingest factory
  receives `runGroupSessionTurn: (s, r, b) => runGroupSessionTurn(s, r, b)`.
  Both callbacks read lazily (same pattern as G5b `isStarted` and the
  listener's `pumpRoom` arrow), resolving the circular order constraint:
  ingest needs the turn runner, the turn needs the JID lookup.
- Dropped `GROUP_JOIN_SKEW_MS` and `isAiSender` from the `contracts` import in
  `gateway.ts` (now used only by the moved code; `ROUND_MAX_HOPS` stays, still
  used by the delegation branch). The `contracts` re-export block is untouched.
- All call sites keep the same text: room-listener wiring (line 122),
  delegation `pumpRoom` (line 422), `handleIncoming` -> `handleRoomIncoming`
  (line 620).

Whitespace-insensitive diff (`diff -w` old block from HEAD vs new file body):
only two differences, both wrapper-level:
1. `roomListener.noteListenerMessage(...)` -> `noteListenerMessage(...)`
   (listener passed as `ctx` callback, per spec).
2. The added factory wrapper `return { sessionForAiJid, handleRoomIncoming,
   pumpRoom };` (+ `normBareJid` import source corrected to `../context`,
   where it lives — first test run caught it imported from `./contracts`).
No logic edits, no renames.

Files changed (3, all in Allowed files):
- `apps/server/src/agents/gateway/group-ingest.ts` (new)
- `apps/server/src/agents/gateway.ts` (factory wiring, removed moved
  functions, dropped 2 now-unused imports)
- `work/T-0549-agents-g8b-extract-group-ingest.md` (this report)

Commands and real results:
- `pnpm install`: ok (36.8s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/agents/gateway.test.ts`: first run 68 failed with
  `TypeError: normBareJid is not a function` (wrong import source in the new
  file); after the one-line import fix: 168 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/agents/listener src/agents/gateway`: 2 files, 181 passed. (The earlier
  full `src/agents` run had 15 files passed and only `gateway.test.ts`
  failing on the import bug, so the whole agents suite is green with the fix;
  no test file was modified.)
- `pnpm gate`: first full run failed only on `format` (new file needed
  prettier); fixed with `prettier --write` on that one file (no logic touched;
  `gateway.ts` already passed the check). Final `pnpm gate`:
  `gate: 3 changed file(s) against main` / PASS install / PASS format /
  PASS lint / PASS typecheck / PASS tests @zilar/server / `scope: every
  changed file is inside the Allowed files` / GATE PASS.

Security checklist: no secrets touched; no new routes; no deletes/updates;
verbatim move so all caps, scoping and permission checks are unchanged.

No deviations from the spec, no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-08). G8b: sessionForAiJid, handleRoomIncoming and pumpRoom moved into agents/gateway/group-ingest.ts (createGroupIngest). Lead diff (whitespace-insensitive) against main: identical except roomListener.noteListenerMessage becoming the injected noteListenerMessage, plus the factory return. Lazy arrows make the order between the two factories safe. Nits accepted: an unbound closure reference (safe; listener.ts uses closures) and the factory order. Pre-review clean.
