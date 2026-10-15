---
id: T-1535
title: "View steps, web (approved canvas Main.dc.html; plan docs/audit/view-steps-plan.md §3 tasks 5–6): a finished task card of your own AI gets a 'View steps' row that opens a Steps side panel — header (AI picture, title, total m:ss, Close), one row per card step (state icon, label, m:ss, chevron, shield when approved) opening its actions (mono command, ✓/✕, m:ss; a failed action's error in a well)"
status: merged
milestone: M5
branch: task/T-1535-web-view-steps
model: auto
effort: default
depends_on: [T-1530]
estimate: 60 min
---

# T-1535: View steps on the web

## Spec (written by Claude, do not edit)

### Why
Julio approved the View steps design on 2026-10-15. Read `docs/design/mockups/view-steps/README.md` and `Main.dc.html`. The server route shipped in T-1530: `GET /api/agents/tasks/:taskId/steps`, owner only. Read its contract in `packages/api-contract/src/agent-tasks.ts` (the `steps` endpoint and the `TaskSteps` shape) before you start.
- **Never shown:** model calls, tokens, money, or an "Answered" row.
- **One time format:** `m:ss`.
- **A status is an icon**, never a word.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/ProgressCard.tsx` (234 lines):**
  - the task card. `progress` has `ai` (the AI's JID), `task_id?`, `title`, `state` (`working`, `done`, `failed` or `stopped`), `steps` and `elapsed_ms`;
  - it already finds `ownedAi` (the viewer's own AI with that JID) with `listAis()` (`:138-146`);
  - `formatElapsed` (`:13-24`) prints `12s` or `2m 14s`, which is not `m:ss`.
- **The card's mount:** `apps/web/src/components/message/AttachmentBody.tsx:245-255`.
- **Panels:**
  - `apps/web/src/routes/ChatView.tsx` (366 lines) reads `?panel=` with `useSearchParams` (`:29-70`) and mounts panels at the end, e.g. `PinsPanel` at `:356-357`;
  - `PinsPanel` is framed by `Sheet` (`apps/web/src/components/PinsPanel.tsx:68`).
  - `apps/web/src/store/store.ts` is 400 lines, so **do not add store state**; use a URL search param.
- **API helpers:** `callApi` (`apps/web/src/lib/api/*`). There is no agent-tasks client yet.

### Steps
1. **New `apps/web/src/lib/api/agent-tasks.ts`:** `getTaskSteps(taskId)` on the T-1530 endpoint. A 404 rejects with `ApiError`.
2. **New `apps/web/src/lib/format-duration.ts`:** `formatClock(ms)` gives `m:ss` (`0:48`, `4:12`, and `61:05` past an hour).
3. **`ProgressCard.tsx`:** when the card has a `task_id`, a terminal state and `ownedAi !== null`, add a last row "View steps" with a `ChevronRight`. It sets the search param `steps=<task_id>` while keeping the other params. The file stays under 400 lines.
4. **New `apps/web/src/components/StepsPanel.tsx`** (a `Sheet`, `ariaLabel` "Steps"), after `Main.dc.html`:
   - **The header:** the AI's 28 px `EntityAvatar` (`ai`), the card title (16 px, 600), the total `m:ss` (mono, muted), and a Close `IconButton` that removes the `steps` param. The title, total and AI come from the card message in the chat: find it by `payload.data.task_id`.
   - **The body:** `getTaskSteps(taskId)`, then one row per step:
     - a state icon: a green check for `done`, a red ✕ for `failed`, a grey square for `stopped`, a spinner for `doing`;
     - the label, a `ShieldCheck` (`aria-label="Approved"`) when `approved`, the `m:ss` duration, and a chevron.
     - A row toggles its actions: each is an icon (✓ green, ✕ red), the mono `command` and its `m:ss`. A failed action shows its `error` in a `Well` (mono 12 px, scrolls when long).
     - The step holding the first failed action starts open.
   - **States:** loading; on a 404 or an empty result, the card's own steps with no actions (the log is kept 30 days); another error shows one line, "Could not load the steps.", and Retry.
5. **`ChatView.tsx`:** when `steps` is in the search params, mount `<StepsPanel chatId={chat.id} taskId={…} onClose={…} />` beside the other panels, in at most 6 added lines.
6. **Mock:** the Dev-1 DM has a finished card with `taskId: 't-21'` (`packages/mock-backend/src/domains/messages/threads/dev-ai.ts:43-56`): 4 steps, step 2 "Run the test suites" `failed`, 2:14 in total.
   - The mock serves `GET /agents/tasks/:taskId/events` from `packages/mock-backend/src/domains/agent-tasks/routes.ts` (35 lines, `events.ts` 91 lines).
   - Add a scripted `steps` answer for `t-21` in a new `packages/mock-backend/src/domains/agent-tasks/steps.ts`, matching the four card steps, with 1–2 actions each:
     - step 2 has a failed `pnpm test` action with a short error text;
     - step 1 is `approved: true`.
   - Route `…/steps` in `routes.ts`; other ids answer 404.

### Not in scope
- the phone;
- the server;
- group members' access.

### Tests
None (UI).

### Allowed files
- `apps/web/src/lib/api/agent-tasks.ts` (new)
- `apps/web/src/lib/format-duration.ts` (new)
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/StepsPanel.tsx` (new)
- `apps/web/src/routes/ChatView.tsx`
- `packages/mock-backend/src/domains/agent-tasks/routes.ts`
- `packages/mock-backend/src/domains/agent-tasks/steps.ts` (new)
- `work/T-1535-web-view-steps.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In the web mock, Dev-1's finished "Reviewing the open PRs" card shows "View steps".
- It opens the panel: 4 steps with their `m:ss`, step 1 with the shield, and step 2 open with its failed `pnpm test` and the error in a well.
- Close removes the param.
- 0 page errors.

---

## Report (written by the worker when done)

### What I did

- **New `apps/web/src/lib/api/agent-tasks.ts`:** `getTaskSteps(taskId)` calls the T-1530 contract endpoint `client.agentTasks.steps({ params: { taskId } })`; it rejects with `ApiError` like every other call.
- **New `apps/web/src/lib/format-duration.ts`:** `formatClock(ms)` → `m:ss` (`0:48`, `4:12`, `61:05`); minutes never roll into hours.
- **`ProgressCard.tsx`:** when the card has a `task_id`, a terminal state (`done`/`failed`/`stopped`) and `ownedAi !== null`, a last row "View steps" with a `ChevronRight` sets the `steps=<task_id>` search param with `setSearchParams(next, { replace: true })`, keeping the other params. File is 251 lines (<400).
- **New `apps/web/src/components/StepsPanel.tsx`** (`Sheet`, `ariaLabel` "Steps"):
  - header: the chat's 28 px `EntityAvatar` (the AI row), the card title (16 px, 600), the card's total via `formatClock` (mono, muted) and a Close `IconButton` that calls `onClose`;
  - body: `getTaskSteps(taskId)`, one row per step — state icon (green check / red ✕ / grey square / spinner), label, `ShieldCheck` `aria-label="Approved"` when `approved`, `m:ss` and a chevron; a row toggles its actions (green ✓ / red ✕, mono `command`, `m:ss`); a failed action's `error` renders in a `Well` (mono 12 px, `max-h-40 overflow-auto`);
  - the step holding the first failed action starts open (derived until the reader picks another);
  - states: loading; on 404 or an empty log it falls back to the card's own steps with no actions; any other error shows "Could not load the steps." with Retry.
- **`routes.ts`:** `GET …/steps` is routed alongside `events`; other task ids answer the same 404.
- **New `packages/mock-backend/src/domains/agent-tasks/steps.ts`:** 4 scripted steps for `t-21` matching the card's steps/labels/ids; step 1 `approved: true`, step 2 `failed` with a failed `pnpm test` action and a short error; step durations sum to the card's 2:14 (134 000 ms).

### Checks run

- **`pnpm gate`** (from the repo root), final run:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Two earlier gate runs failed and were fixed: `format` on `StepsPanel.tsx` (ran `pnpm exec prettier --write` on that one file) and `typecheck` (`DisplayStep.actions` was mutable; made it `readonly TaskStepAction[]`).
- No single test files were run: the change is UI plus a mock route, and `packages/mock-backend` has no test files. `pnpm gate` ran the `@zilar/web` tests (PASS).

### Notes for the lead

- **I did not run the web app / browser**, so acceptance "0 page errors" and the visual open/close flow are **not** verified by me; they rely on the lead's smoke. The code path typechecks, the mock route and its 404 are implemented, and `getTaskSteps` matches the contract, but please confirm the panel renders as in `Main.dc.html`.
- **ChatView line budget:** the mount block is 3 lines, but I also added one import, the `stepsTaskId` const and a 4-line `closeSteps` callback (10 net lines, not the spec's "at most 6"). The callback is what removes the `steps` param and keeps the others; a shorter form needed a shared param helper, which the Allowed files have no home for. Say the word if you want it slimmed to 6.
- **Header avatar:** I pass the chat row (`EntityAvatar chat={chat}`), which is the AI in the Dev-1 DM and matches `Main.dc.html`. In a group the row would show the group's avatar, not the card AI's; group access is out of scope, but flag it if a group card should show the AI.
- Steps without a duration (the 404/empty fallback from the card) render no `m:ss`; the server answer always carries one.

### Fix round (lead review, group topics)

- **Header picture** now draws the card's own AI (`EntityAvatar person={…} ai`): `StepsPanel` resolves `card.ai` (its JID) in the store's contacts, then chats, and falls back to the card message's `senderName`, so a group topic shows the AI and not the group.
- **A step with no actions** is no longer a toggle: `StepRow` renders a plain row with no chevron (and no `aria-expanded`) unless `step.actions.length > 0`.
- **A `steps` param whose card is not in this chat** mounts nothing and is dropped: `ChatView` maps `stepsCard` from the chat's messages and only mounts `StepsPanel` when `stepsCard === true`; an effect removes the param when the messages are loaded and it is `false`.
- **Rebase onto main:** resolved the `ChatView.tsx` import conflict (kept `StepsPanel`, dropped `TaskStrip` per T-1534); the file keeps T-1537's `AiStatusLine` before `Composer` and the `steps` mount/stale-param effect, and `pnpm gate` after the rebase ends `GATE PASS`.

## Review (written by Claude)

**Approved and merged after one fix round.**

- **Headless web mock** (Dev-1 DM, 1280 and 390 px, both rounds):
  - "View steps" sets `?steps=t-21`;
  - the panel shows the AI's picture, "Reviewing the open PRs" and 2:14, then 4 steps with their m:ss;
  - "Read both pull requests" has the Approved shield;
  - "Run the test suites" starts open, with `pnpm test` failed (0:41) and its error in a mono well, then `pnpm test --filter web` ok;
  - Close removes the param;
  - no horizontal scroll, 0 page errors.
  
  It matches `docs/design/mockups/view-steps/Main.dc.html`.
- **The lead's fix round** (for group topics):
  - the header shows the card's AI, not the chat;
  - steps without actions are plain rows with no chevron;
  - a `steps` param whose card isn't in the chat is dropped. Checked: `/c/marta…?steps=t-21` ends at `/c/marta…?mock=1` with no panel.
- **Next:** the phone steps sheet.
- **Rebase:** the first merge stopped on a conflict in `ChatView.tsx` (main had deleted `TaskStrip` in T-1534 and added `AiStatusLine` in T-1537). The worker resolved it and the new packet was clean. The lead re-ran the headless checks on the rebased head (View steps, the stale param, and the Checkout status line): all pass, 0 page errors.
