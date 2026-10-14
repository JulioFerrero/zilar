---
id: T-1425
title: "Computer picker on web and mobile: Off / Zilar cloud / My machine / Auto per AI (next to the home machine); GET /api/ais/computer-options says whether Zilar cloud is available"
status: merged
milestone: M5
branch: task/T-1425-computer-picker
model: auto
effort: default
depends_on: [T-1423]
estimate: 0.6 day
---

# T-1425: Computer picker (web + mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: each AI can get a computer, either on Zilar cloud or on the owner's own runner ("My machine"). T-1423 (merged) made the server resolve `computer_mode` = `off | cloud | runner | auto`, where auto means the runner when it's online, else cloud. **The owner can't choose it yet.**

This is the plan's Task H UI (`docs/audit/desk-runner-plan.md` §6.6).

### Facts (the lead checked them on main, 2026-10-15)
- **The contract:** `PublicAi.computerMode` (`packages/api-contract/src/ais.ts:94`). The AI patch accepts `computerMode` (`:151`). `runner` and `auto` need the AI's `machineId` set, or the server answers 400 (T-1423).
- **The home machine is already picked:**
  - web `apps/web/src/components/ais/AiMachineSection.tsx` (109 lines; it lists the owner's approved machines, plus "The platform"), used at `apps/web/src/components/ais/AiPanel.tsx:294`;
  - mobile `apps/mobile/src/components/ais/machine-picker.tsx` (93 lines), used at `apps/mobile/src/app/ais/[id].tsx:340`.
- **Whether Zilar cloud desks are on:** `buildDeskClient` in `apps/server/src/hands/wiring.ts`. It is null when `DESK_AGENT_SOCKET`/`DESK_IMAGE` are unset, which is the case in production today.
- **Clients:** web `apps/web/src/lib/api/ais.ts`, mobile `apps/mobile/src/lib/ais-api.ts`. The mock is `packages/mock-backend/src/domains/ais/`.
- **A stale comment** (T-1423 follow-up): `apps/server/src/agents/tools/desk-definitions.ts:16` says the tools are offered only for `cloud`. Fix the wording: they're offered whenever the AI's computer resolves.

### What to build
1. **`GET /api/ais/computer-options`** (session required) → `{ cloud: boolean }`: true when the cloud desk client is wired. Add it to the contract, the server and the mock (`cloud: true` in mock).
2. **The "Computer" section**, web and mobile, placed with the home machine picker. A single choice:
   - **Off**: "No computer";
   - **Zilar cloud**: disabled with the hint "Not available yet" when `cloud` is false;
   - **My machine**: uses the home machine; disabled with the hint "Pick a machine first" when none is set;
   - **Auto**: "My machine when it's online, otherwise Zilar cloud"; it needs a home machine.
   
   Each option has a one-line description. Saving patches `computerMode` right away (like the machine picker), shows the server's error text on failure, and reverts the choice. Icons only (no emoji): web lucide, mobile the same set the nearby components use.
3. **The stale comment** fix above.

### Tests
None (UI). The server route is trivial, but add one case in the existing AI route tests if they're nearby: it answers `{ cloud: false }` without the env.

### Allowed files
`packages/api-contract/src/ais.ts`, `apps/server/src/ais/**`, `apps/server/src/hands/wiring.ts`, `apps/server/src/agents/tools/desk-definitions.ts`, `apps/server/src/main.ts`, `apps/server/src/app.ts`, `packages/mock-backend/src/domains/ais/**`, `apps/web/src/components/ais/**`, `apps/web/src/lib/api/ais.ts`, `apps/web/src/lib/api.ts`, `apps/mobile/src/components/ais/**`, `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/lib/ais-api.ts`, `work/T-1425-computer-picker.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- **Web `?mock=1`:** the AI panel shows Computer with four options; My machine and Auto are disabled for an AI without a home machine.

---

## Report (written by the worker when done)

### What I did
- **Contract** (`packages/api-contract/src/ais.ts`): added `AiComputerOptions = Schema.Struct({ cloud: Schema.Boolean })` and the session-required endpoint `GET /ais/computer-options` (group prefix → `/api/ais/computer-options`). It needs no `AisConfigured` gateway, like `list` / `detail` / `catalog`.
- **Server** (`apps/server/src/ais/api.ts`): added a required `cloud: boolean` to `AisApiDependencies` and a `computerOptions` handler returning `Effect.succeed({ cloud })`. Static path wins over `GET /ais/:id` (verified by the new test).
- **Wiring**: `apps/server/src/main.ts` builds the desk client once (`const desk = buildDeskClient(config, logger)`) before `createApp` and passes `ais: { cloud: desk !== null }`; the gateway below reuses the same value. `apps/server/src/app.ts` adds `cloud?: boolean` to the `ais` deps override and passes `cloud: ais?.cloud ?? false` (so tests without the env answer `{ cloud: false }`).
- **Mock** (`packages/mock-backend/src/domains/ais/routes.ts`): `GET /api/ais/computer-options` → `{ cloud: true }`, answered before the `:id` lookup.
- **Stale comment** (`apps/server/src/agents/tools/desk-definitions.ts`): now says the tools are offered whenever the AI's computer resolves (any mode but `off`, with a Hands client), not only for `cloud`.
- **Web**: `getComputerOptions()` in `apps/web/src/lib/api/ais.ts` (+ re-exports in `apps/web/src/lib/api.ts`); new `AiComputerSection.tsx` (Off / Zilar cloud / My machine / Auto, one line each, lucide icons, optimistic patch with revert, `describeFailure` message) rendered next to `AiMachineSection` in `AiPanel.tsx`. Zilar cloud is disabled with "Not available yet" when `cloud` is false; My machine and Auto are disabled with "Pick a machine first" when the AI has no `machineId`.
- **Mobile**: `getComputerOptions()` in `apps/mobile/src/lib/ais-api.ts`; new `computer-picker.tsx` (same four choices, `lucide-react-native` icons, same disable rules) rendered under "Computer" in `apps/mobile/src/app/ais/[id].tsx`, patched right away with revert, same fixed-sentence error path as the machine picker.

### Files changed
Contract: `packages/api-contract/src/ais.ts`.
Server: `apps/server/src/ais/api.ts`, `apps/server/src/ais/provisioning.test.ts`, `apps/server/src/app.ts`, `apps/server/src/main.ts`, `apps/server/src/agents/tools/desk-definitions.ts`.
Mock: `packages/mock-backend/src/domains/ais/routes.ts`.
Web: `apps/web/src/lib/api/ais.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/ais/AiComputerSection.tsx` (new), `apps/web/src/components/ais/AiPanel.tsx`.
Mobile: `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/components/ais/computer-picker.tsx` (new), `apps/mobile/src/app/ais/[id].tsx`.
Task file: `work/T-1425-computer-picker.md`.

### Commands and real results
- `pnpm install` → `Done in 11.7s`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/provisioning.test.ts` → 3 passed (added the `{ cloud: false }` case).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` → 5 passed; the table lists `GET /api/ais/computer-options -> 401`, so the new route is covered by the sweep.
- `pnpm exec prettier --write` on the two files the first gate flagged, then:
- `pnpm gate` (repo root) summary:
  - `gate: 15 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP tests @zilar/api-contract (no nearby test files)`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/mock-backend (no nearby test files)`, `PASS tests @zilar/server`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
1. The spec says the Computer picker "shows the server's error text on failure". I followed the existing machine picker path (`describeFailure` / `describeAisError`), which keeps the server's text for `invalid_request` (the 400 the server actually returns for `runner`/`auto` without a machine, T-1423) and uses fixed sentences for other codes — the AGENTS.md pitfall says user-facing errors are fixed sentences, never raw server text. Same result for the expected failure, no raw internals.
2. I did not add a helper in `apps/server/src/hands/wiring.ts`; the single source of truth is still `buildDeskClient` (main.ts passes `desk !== null`). `app.ts` defaults the flag to `false` when the dep is absent, which is what the route test relies on.
3. No new UI tests (per the task and AGENTS.md); the one server test covers the route.

### Open questions / notes
- `Auto` is disabled only when the AI has no home machine, as the spec says. When a machine is set but Zilar cloud is off, `auto` stays selectable and would fall back to cloud only if the machine is offline; the server's own `resolveDeskForAi` decides that at turn time. Say the word if `auto` should also require `cloud`.

### Lead round (2026-10-14)
- The edit screen was 439 lines, over the 400 limit. Moved the computer-mode state, cloud read and save-and-revert into a new hook `apps/mobile/src/components/ais/use-computer-mode.ts`; the picker now renders its own inline error (and an optional `label`), so the screen just holds `const computer = useComputerMode(api, loaded?.id ?? null)`, calls `computer.adopt(ai)` on load and renders `<ComputerPicker label="Computer" ... />`. Behaviour is unchanged.
- `wc -l apps/mobile/src/app/ais/[id].tsx` → **388** (was 439). `use-computer-mode.ts` 84 lines, `computer-picker.tsx` 132 lines.
- `pnpm gate` (repo root): `16 changed file(s)`, `PASS install / format / lint / typecheck / effect`, `PASS tests @zilar/mobile / @zilar/server / @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

## Review (written by Claude)
Lead, 2026-10-15: approved after the lead size round ([id].tsx 439 → 388; logic moved to use-computer-mode.ts). Pre-review CLEAN, follow-up 2 (stale sibling comments).
- Web ?mock=1: the AI panel shows Computer with 4 options (Off, Zilar cloud, My machine, Auto) under 'Runs on'.
- Phone smoke PASS (/ais/ai-dev-1); scrolled on the emulator to the same 4 options under 'Home machine'.
