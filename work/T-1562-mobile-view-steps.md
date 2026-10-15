---
id: T-1562
title: "View steps, phone (approved canvas view-steps/Phone.dc.html; twin of web T-1535): a finished task card of your own AI gets a 'View steps' row that opens a bottom sheet with the AI picture, title, total m:ss and Close, then one row per step (state icon, label, shield when approved, m:ss, chevron) opening its actions (mono command, ✓/✕, m:ss; a failed action's error in a well)"
status: merged
milestone: M5
branch: task/T-1562-mobile-view-steps
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1562: View steps on the phone

## Spec (written by Claude, do not edit)

### Why
Julio approved View steps on 2026-10-15. Read `docs/design/mockups/view-steps/README.md` and `Phone.dc.html`.
- **The server route:** `GET /api/agents/tasks/:taskId/steps`, owner only (T-1530). Its contract is the `steps` endpoint and `TaskSteps` in `packages/api-contract/src/agent-tasks.ts`.
- **The web panel:** T-1535. Read `apps/web/src/components/StepsPanel.tsx` for the behaviour to match.

**Rules:**
- never shown: model calls, tokens, money, or an "Answered" row;
- one time format, `m:ss`;
- a status is an icon, never a word.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/chat/progress-card.tsx` (213 lines):** the task card, `ProgressCard({ data })` (`:92`).
  - `data` has `ai` (JID), `task_id?`, `title`, `state`, `steps` and `elapsed_ms`.
  - `isLive(state)` is at `:30`.
  - `ownedAi` (the viewer's own AI with that JID) comes from `api.listAis()` through `useAisApi()` (`:115-124`).
- **The web pieces to mirror:**
  - `apps/web/src/lib/format-duration.ts` (`formatClock(ms)` → `m:ss`);
  - `apps/web/src/lib/api/agent-tasks.ts` (`getTaskSteps`).
- **The phone contract client:** `apps/mobile/src/lib/ais-api.ts` (`createAisApi`, `runApi(client.ais.…)`). The derived client in `apps/mobile/src/lib/effect/api-client.ts` exposes every contract group, including `agentTasks`.
- **Sheets:** `BottomSheet` is in `apps/mobile/src/components/ui/bottom-sheet.tsx:72`.
- **The mock:** it serves `/agents/tasks/t-21/steps` for Dev-1's finished "Reviewing the open PRs" card in the Dev-1 DM (T-1535: 4 steps, step 1 approved, step 2 with a failed `pnpm test`).

### Steps
1. **`formatClock` moves to chat-core,** so web and phone share it: add it to a new `packages/chat-core/src/format-duration.ts` (export it from the index). `apps/web/src/lib/format-duration.ts` re-exports it, so web importers don't change.
2. **New `apps/mobile/src/lib/agent-tasks-api.ts`:** `getTaskSteps(taskId)` on the contract's `steps` endpoint, in the same style as `ais-api.ts`.
3. **`progress-card.tsx`:** when the card has a `task_id`, a terminal state and `ownedAi !== null`, add a last row "View steps" with a `ChevronRight`, which opens the sheet.
4. **New `apps/mobile/src/components/chat/steps-sheet.tsx`,** a `BottomSheet` after `Phone.dc.html`:
   - **the header:** the AI's 28 px `EntityAvatar` (`ai`, from the card's JID), the card title (16 px, 600), the total `m:ss` (mono, muted), and a Close `IconButton`;
   - **the body:** `getTaskSteps(task_id)`, then one row per step:
     - a state icon: green check for done, red ✕ for failed, grey square for stopped, a spinner for doing;
     - the label, a `ShieldCheck` (`accessibilityLabel` "Approved") when approved, the `m:ss`, and a chevron only when the step has actions;
     - a row with actions toggles them: each is an icon (✓/✕), the mono `command` and its `m:ss`; a failed action shows its `error` in a mono 12 px well;
     - the step with the first failed action starts open.
   - **States:**
     - loading;
     - on a 404 or an empty result, the card's own steps with no actions;
     - any other error shows "Could not load the steps." and Retry.
5. **Every file stays under 400 lines.**

### Not in scope
- web (only the `formatClock` move);
- the server;
- group members' access.

### Tests
One chat-core case for `formatClock` (0 → "0:00", 48000 → "0:48", 252000 → "4:12", 3665000 → "61:05").

### Allowed files
- `packages/chat-core/src/format-duration.ts` (new)
- `packages/chat-core/src/format-duration.test.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/format-duration.ts`
- `apps/mobile/src/lib/agent-tasks-api.ts` (new)
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx` (new)
- `work/T-1562-mobile-view-steps.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/format-duration.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Phone mock `/chat/ai-dev-1@zilar.test`:** Dev-1's finished "Reviewing the open PRs" card shows "View steps". The sheet, read in the code since the smoke cannot tap, shows the 4 steps with m:ss, the shield on step 1, and step 2 open with its failed `pnpm test` and the error.

---

## Report (written by the worker when done)

### What I did

**1. `formatClock` moved to chat-core (shared by web and phone).**
- `packages/chat-core/src/format-duration.ts` (new): the `m:ss` formatter, same body as web's old copy (minutes never roll into hours).
- `packages/chat-core/src/format-duration.test.ts` (new): the one case the spec asked for (0 → `0:00`, 48000 → `0:48`, 252000 → `4:12`, 3665000 → `61:05`).
- `packages/chat-core/src/index.ts`: added `export * from './format-duration'`.
- `apps/web/src/lib/format-duration.ts`: now a one-line `export { formatClock } from '@zilar/chat-core'`, so web importers (e.g. `StepsPanel.tsx`) are unchanged.

**2. `apps/mobile/src/lib/agent-tasks-api.ts` (new).** A pure Promise port over the contract's `steps` endpoint, in the same shape as `ais-api.ts`/`pins-api.ts`: `createAgentTasksApi(getToken, fetchImpl, apiUrl)` returns `{ getTaskSteps(taskId) }`, which calls `runApi(client.agentTasks.steps({ params: { taskId } }))`. `ApiError` (with `status`) is the rejection, so the sheet can tell a 404 apart.

**3. `apps/mobile/src/components/chat/progress-card.tsx`.** Owns `stepsOpen`. For a card with `task_id`, a terminal state (`!isLive(state)`) and `ownedAi !== null`, it renders a last "View steps" row (label + `ChevronRight`, top divider) and the `StepsSheet`, passing the card, the task id and the owned AI's name/avatar.

**4. `apps/mobile/src/components/chat/steps-sheet.tsx` (new).** A `BottomSheet` after `Phone.dc.html`:
- header: the AI's 28 px `EntityAvatar` (card JID, `ai`), the card title (16 px / 600), the total `formatClock(elapsed_ms)` (mono, muted) and a Close `IconButton`;
- body: `getTaskSteps(task_id)`; one row per step (state icon: green check / red ✕ / grey square / spinner, label, `ShieldCheck` with `accessibilityLabel="Approved"`, `m:ss`, chevron only when the step has actions);
- an open step lists each action (✓/✕, mono `command`, `m:ss`); a failed action shows its `error` in a mono 12 px `well` (the `depth.ts` recipe);
- states: inline loading; on a 404 or an empty result, the card's own steps with no actions (`planned` → `stopped`); any other error shows "Could not load the steps." with Retry;
- the step with the first failed action starts open; the choice resets when the sheet closes so it re-defaults.

Mock wiring: the sheet selects `mockFetch` (shared mock backend) vs the real client with the same `?mock=` / `EXPO_PUBLIC_ZILAR_MOCK` gate the sibling `use-*-api` hooks use, which is how it reaches the mock `/agents/tasks/t-21/steps`.

### Checks run

- `pnpm install`: done, "Done in 15.8s", 1251 resolved. One pre-existing peer warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18), unrelated to this change.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/format-duration.test.ts`: **1 file passed, 1 test passed**.
- `pnpm gate` (from the repo root, final run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/chat-core  (1.2s)
  PASS  tests @zilar/mobile  (1.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Earlier gate runs failed twice and I fixed both inside scope: (a) Prettier wanted one JSX `<Text>` wrapped in `steps-sheet.tsx`; (b) oxlint `react(set-state-in-effect)` rejected a reset effect in the sheet, so the reset now happens in the sheet's Close handler instead; (c) the Effect ratchet flagged the new `agent-tasks-api.ts` as `needs-effect` (a plain port that read `process.env`), so the mock/env gate moved into the `effect`-classified sheet, leaving the port pure like `ais-api.ts`.

### Files changed
- `packages/chat-core/src/format-duration.ts` (new)
- `packages/chat-core/src/format-duration.test.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/format-duration.ts`
- `apps/mobile/src/lib/agent-tasks-api.ts` (new)
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx` (new)
- `work/T-1562-mobile-view-steps.md`

### Deviations / notes for the lead
- **Fix round:** the sheet keeps its mount (so the native open animation is unaffected) but now starts its read only while open — `useQuery(() => visible ? fromApi(() => api.getTaskSteps(taskId)) : Effect.never, [api, taskId, visible])` in `steps-sheet.tsx`, mirroring `invite-sheet.tsx`, so a chat full of finished cards makes no per-card request; opening (or reopening) fetches.
- **No separate mock hook file.** The task's Allowed files list only `agent-tasks-api.ts`, so the `?mock=`/env selection lives in `steps-sheet.tsx` (mirroring `link-preview-card.tsx`), not a `use-agent-tasks-api.ts`. Keeping it out of the port is also what makes the Effect ratchet pass.
- **"View steps" row placement.** It sits at the bottom of the card and is visible even when the card is collapsed, so a finished owned card shows it without a tap (the phone smoke cannot tap). It is only shown for a terminal, owned card with `task_id`.
- **Sheet is mounted while the card is.** `visible` toggles the native sheet; the open-step choice resets on close via the Close handler (not an effect, per the lint rule).
- Not done, by scope: web UI beyond the `formatClock` move; the server; group members' access.
- No new dependencies.

### Acceptance check (read in the code, per the spec)
`GET /api/agents/tasks/t-21/steps` (mock) returns 4 steps; `steps-sheet.tsx` renders them with `m:ss`, the `ShieldCheck` when `approved` (step 1), and opens the first step with a failed action (step 2) showing `pnpm test` and its `error` in a well. `stepsMockActive`/`createMockAgentTasks` route through the shared mock backend in mock mode.

## Review (written by Claude)

**Approved and merged after one fix round.**

- **First packet:** clean, with one nit. The lead made the nit a must-fix: the sheet was mounted with every finished owned card, so each one called `GET /api/agents/tasks/:taskId/steps` as the chat rendered. Now the query runs only while the sheet is open (`visible ? fromApi(…) : Effect.never`, with `visible` in the deps). The second packet was clean.
- **Phone smoke** (`/chat/ai-dev-1@zilar.test`, mock): PASS. Dev-1's finished "Reviewing the open PRs" card ends with a "View steps" row and a chevron. The sheet itself was read in the code, since the smoke can't tap.
- **`formatClock` moved to chat-core** with a test. The web file re-exports it, so no web importer changed.
- **Follow-ups:**
  - **Card timers:** both cards (web `ProgressCard.tsx` and phone `progress-card.tsx`) still show "2m 14s". The View steps board shows the card as `4:12`, with one time format (`m:ss`). This is a twin task using `formatClock`.
  - **Fallback steps:** when the route fails for a stopped card, a step left in `doing` renders a spinner (pre-review nit 2). Map it to stopped in the same task.

