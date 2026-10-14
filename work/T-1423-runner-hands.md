---
id: T-1423
title: "P3 server side: RunnerHands (the Hands interface over the runner tunnel) and computer_mode 'runner' / 'auto' (auto = the AI's assigned runner when online, else Zilar cloud); the hub exposes desk ops; the contract accepts the new modes"
status: merged
milestone: M5
branch: task/T-1423-runner-hands
model: auto
effort: default
depends_on: [T-1417, T-1418]
estimate: 1 day
---

# T-1423: RunnerHands and computer modes

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: an AI can use the owner's own **runner** as its computer, "equal or better than our system", seamless and secure (`docs/design/agent-system.md` §2.6). T-1417 (merged) taught the runner to run desks, and gave the tunnel server a request API. This task makes the **server** use it.

This is the plan's Task H server half (`docs/audit/desk-runner-plan.md` §6.6). The web and mobile "Computer" picker is the next task.

### Facts (the lead checked them on main, 2026-10-14)
- **The Hands interface** is `packages/desk/src/hands.ts:113-121` (provision, execute, stop, snapshot); `HandsQueued` follows it. The cloud adapter is `apps/server/src/hands/cloud-hands.ts`, and `buildDeskClient` is in `apps/server/src/hands/wiring.ts` (T-1418).
- **The tunnel server** owns a `DeskServer` (`packages/runner-tunnel/src/server.ts:118`: `this.desk = new DeskServer(...)`).
  - `DeskServer.sendDesk(runnerId, frame)` resolves with the reply frame (ready, error or queued; 30 s default timeout, `desk-server.ts:11`).
  - `openDeskExec(runnerId, deskId)` returns a `net.Socket` duplex carrying the daemon's newline-delimited JSON (`desk-server.ts:77`).
  - The frames and caps are in `packages/runner-tunnel/src/desk-frames.ts`.
- **The hub:** `apps/server/src/machines/hub.ts` (377 lines). `RunnerHub` at `:231-235` exposes only `isOnline`, `close` and `port`; `startRunnerHub` is at `:242`.
- **The AI's runner:** `ais.machine_id`, set by `PUT /ais/:id/machine` (`packages/api-contract/src/ais.ts:230`; the writes are `apps/server/src/ais/status.ts:142,167`, and the reads are `apps/server/src/ais/queries.ts:23,126,183`). **Only `revoked_at IS NULL` machines owned by the AI's owner count.** Check how `machines` rows are read in `apps/server/src/machines/`.
- **`computer_mode`** (T-1409, migration 0057) allows `off|cloud|runner|auto` in the DB. The contract and patch accept only `off|cloud` (`apps/server/src/ais/persona.ts:81`; contract in `packages/api-contract/src/ais.ts`).
- **The turn's desk:**
  - `apps/server/src/agents/gateway/desk-exec.ts` takes one `DeskClient { hands, imageDigest }` for the whole gateway (`:28-32`) and offers the tools when `computer_mode === 'cloud'`;
  - the gateway option is `desk?: DeskClient` (`gateway/contracts.ts:63-66`).

### What to build
1. **The hub exposes the desk ops:** `RunnerHub.deskFor(machineId): RunnerDesk | null` (the methods `sendDesk`/`openDeskExec` bound to that runner), null when the runner is offline. Keep `hub.ts` at most 400 lines; put helpers in a new file.
2. **`apps/server/src/hands/runner-hands.ts`** (new): `createRunnerHands(desk: RunnerDesk): Hands`.
   - **provision** sends `desk.provision`:
     - ready → a `DeskRef`;
     - queued → `throw new HandsQueued(position)`;
     - an error frame → a `HandsError` with the code.
   - **execute** opens `desk.exec` and speaks the same daemon protocol as `cloud-hands.ts`. Share the line parser with `cloud-hands.ts` instead of copying it.
   - **stop** sends `desk.stop`.
   - **snapshot** isn't supported over the runner yet: throw `HandsError('tool_failed', 'snapshot is not available on a runner yet')`.
3. **The resolver:** `apps/server/src/hands/resolve.ts` (new), `resolveDeskForAi({ computerMode, machineId, ownerId })`. It returns `{ hands, imageDigest, where: 'cloud' | 'runner' } | { unavailable: 'offline' | 'no-runner' | 'off' }`.
   - `off` → off.
   - `cloud` → the cloud client (if wired).
   - `runner` → that machine's `RunnerHands` when it's online **and** owned by the owner **and** not revoked; otherwise unavailable `offline`.
   - `auto` → the runner if it's online, else the cloud client.
   - **A revoked or foreign machine never resolves.**
4. **The gateway uses the resolver per turn** instead of the single global client: the tools are offered when it resolves to hands. When the mode is `runner` and the runner is offline, the turn still offers no tools, and the card's stage says "Waiting for your computer" (a fixed string).
5. **The contract and the patch** accept `computerMode: 'off' | 'cloud' | 'runner' | 'auto'`. `runner` and `auto` need a `machine_id` set: refuse with a 400 otherwise, using the existing error style. Update the mock backend's AI route.

### Tests (permissions: required)
`apps/server/src/hands/resolve.test.ts`:
- `auto` falls back to cloud only when the runner is offline;
- a revoked runner, or one owned by someone else, never resolves (it's unavailable, never cloud by accident in `runner` mode);
- `off` never resolves.

`runner-hands.test.ts`: with a fake `RunnerDesk`, provision ready / queued / error map to the ref / `HandsQueued` / `HandsError`.

### Allowed files
`apps/server/src/hands/**`, `apps/server/src/machines/**`, `apps/server/src/agents/gateway/**`, `apps/server/src/ais/**`, `apps/server/src/main.ts`, `packages/api-contract/src/ais.ts`, `packages/runner-tunnel/src/desk-server.ts`, `packages/runner-tunnel/src/index.ts`, `packages/mock-backend/src/domains/ais/**`, `apps/web/src/lib/api/ais.ts`, `apps/mobile/src/lib/ais-api.ts`, `work/T-1423-runner-hands.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/hands --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines; `main.ts` grows by at most 3 lines.
- With no runner hub and no desk env, behaviour is unchanged.

---

## Report (written by the worker when done)

### What I did

Implemented all five spec items:

1. **Hub desk ops.** `RunnerHub.deskFor(machineId)` returns the `sendDesk`/
   `openDeskExec` pair bound to that runner, or null when it is offline. The
   binding helper lives in the new `apps/server/src/machines/runner-desk.ts`, so
   `hub.ts` stays at 396 lines. `TunnelServer.desk` was already public, so
   `packages/runner-tunnel` needed no change.
2. **`apps/server/src/hands/runner-hands.ts`** — `createRunnerHands(desk)` maps
   `desk.ready`/`queued`/`desk.error` to a `DeskRef`/`HandsQueued`/`HandsError`;
   `execute` opens `desk.exec` and shares the daemon line parser and execute loop
   with `cloud-hands.ts` (now exported as `socketLines`/`runExecuteOverSocket`);
   `stop` sends `desk.stop`; `snapshot` throws `HandsError('tool_failed', …)`.
3. **`apps/server/src/hands/resolve.ts`** — `resolveDeskForAi` maps the four
   modes to `{ hands, imageDigest, where }` or `{ unavailable }`. `off` never
   resolves; `cloud` uses the cloud client; `runner` resolves only when the
   machine is online **and** owned by the AI's owner **and** approved/not
   revoked (a revoked or foreign machine is `offline`, never cloud); `auto` uses
   the runner when it resolves, else cloud. Ownership/revocation is checked via
   `findOwnedMachine` scoped to the owner (`machineUsableFor`).
4. **Per-turn resolution in the gateway.** `desk-exec.ts` gained
   `resolveTurnDesk` (`{ client?, waiting }`), called per turn by the DM and
   group turns. The resolved `client` rides the turn context into
   `createTurnDeskRunner`; the tools are advertised from the same flag. In
   `runner` mode with an offline runner the turn offers no tools and reports the
   fixed stage `"Waiting for your computer"`.
5. **Contract and patch.** `UpdateAiPayload.computerMode` now accepts all four
   modes; the web and mobile input types were widened. `updateAi` refuses
   `runner`/`auto` with a 400 (`invalid_request`) when the AI has no assigned
   machine. The mock backend's `PATCH` accepts the four modes and returns the
   same 400.

### Files

- New: `apps/server/src/hands/runner-hands.ts`, `runner-hands.test.ts`,
  `apps/server/src/hands/resolve.ts`, `resolve.test.ts`,
  `apps/server/src/machines/runner-desk.ts`.
- Edited: `apps/server/src/hands/cloud-hands.ts`,
  `apps/server/src/machines/hub.ts`,
  `apps/server/src/agents/gateway/{contracts,desk-exec,tool-exec,dm-turn,group-turn-body,db}.ts`,
  `apps/server/src/ais/{persona,provisioning,queries}.ts`,
  `apps/server/src/main.ts`, `packages/api-contract/src/ais.ts`,
  `packages/mock-backend/src/domains/ais/routes.ts`,
  `apps/web/src/lib/api/ais.ts`, `apps/mobile/src/lib/ais-api.ts`.

### Commands and real results

- `pnpm install` — done, 10.8s.
- `pnpm --filter @zilar/server exec vitest run src/hands --maxWorkers=2 --reporter=dot`
  — 4 files passed, 21 tests passed. (The spec's check command is the same
  without the worker cap; AGENTS.md requires the cap, so I ran the capped form.)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands src/agents/gateway-desk.test.ts`
  — 5 files passed, 22 tests passed (the existing cloud desk test still passes).
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 22 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP  tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile
  SKIP  tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Acceptance

- Gate passes; every changed/created file is at most 400 lines (longest:
  `dm-turn.ts` 398, `hub.ts` 396).
- `main.ts` grew by 2 net lines.
- With no runner hub and no desk env: `resolveTurnDesk` short-circuits to
  `{ waiting: false }`, so no tools are offered and behaviour is unchanged.

### Deviations from the spec

- **Resolver signature.** `resolveDeskForAi` takes one object with the three
  decision inputs (`computerMode`, `machineId`, `ownerId`) plus injected
  dependencies (`cloud`, `runnerImage`, `hub`, `isMachineUsable`) so it is pure
  and unit-testable. The three named inputs are unchanged.
- **Runner image.** The runner desk's `imageDigest` is the configured cloud desk
  image (`config.DESK_IMAGE`, via the cloud client). When it is unset, `runner`
  mode is unavailable. A runner-only server with no `DESK_AGENT_SOCKET`/
  `DESK_IMAGE` cannot serve `runner` yet — the runner does not report its image
  to the server. (Open question below.)
- **Stage string.** `apps/server/src/agents/tool-guide.ts` is outside the
  Allowed files, so the new fixed string lives in
  `gateway/desk-exec.ts` as `TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER`
  (`"Waiting for your computer"`). The pre-existing
  `TOOL_STAGE_WAITING_FOR_COMPUTER` is `"Waiting for a computer"`, a different
  string used by the queued case.
- **`main.ts` cast.** The leader's `onRunnerHub` callback type is narrowed to
  `Pick<RunnerHub, 'isOnline' | 'close'>` in `apps/server/src/leader/start.ts`
  (outside the Allowed files), so `main.ts` widens it once with
  `hub as RunnerHub | null` to keep `deskFor`.
- Widened the web/mobile `computerMode` input types (Allowed, not required) so
  the picker task can set the new modes.
- No migration: `computer_mode` already exists (T-1409, migration 0057).

### Blocked / needs a decision

None blocking. One open question for the lead:

- Should `runner` mode work on a server with no cloud desk configured (no
  `DESK_IMAGE`)? If yes, the runner needs to report its pinned image (or the
  server needs a separate runner-image setting); today the runner image comes
  from the cloud config.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 2, follow-up 1.
- Read resolve.ts: isMachineUsable (owner, approved, not revoked) runs before hub.deskFor; 'runner' never falls back to cloud; 'auto' falls back only when the runner can't serve.
- Local tests: hands, agents and ais (15 files, 76).
- main.ts grows by 2 net.
- Follow-up for the Computer-picker task: the stale comment at desk-definitions.ts:16.
