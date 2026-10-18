---
id: T-2066
title: "Share (web + phone twins): the task-steps view model (DisplayStep, toDisplayStep, fallbackSteps, the loaded/gone/loading/errored rule and the default open step) moves to client-core; parseInviteCode and the AI computer choices (mode, label, description, disabled) move to chat-core — each app keeps only its own icons and markup"
status: merged
milestone: M5
branch: task/T-2066-shared-twin-logic
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2066: Shared logic from three web/phone twins

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. The lead's jscpd run (2026-10-18, on `9f93367bc`) found these pieces copied between the web and phone twins:
- the steps view model (23 + 23 + 19 lines);
- `parseInviteCode` (identical);
- the computer choices (47 lines).

They are logic, not markup, so each can live once.

### Facts (read by the lead on 2026-10-18 at `10ac0deaf`)
1. **The steps view model.** It's the same in `apps/web/src/components/StepsPanel.tsx` (291 lines) and `apps/mobile/src/components/chat/steps-sheet.tsx` (306 lines):
   - `interface DisplayStep` (web `:31-39`, phone `:58-66`);
   - `toDisplayStep(step: TaskStep)` (web `:41-50`, phone `:67-76`);
   - `fallbackSteps(card)`: web takes `Progress | undefined` (`:53-62`), phone `Progress` (`:79-…`);
   - the result rule (web `:233-242`, phone `:235-244`): `gone` is a 404, or loaded but empty. Steps are the loaded ones, or the card fallback when gone, or `[]`. `loading` means no data and no failure. `errored` means a non-404 failure;
   - `defaultOpen`, the first step with a failed action (web `:246`, phone `:248`).

   The types come from `@zilar/api-contract` (`TaskStep`, `TaskStepAction`) and `@zilar/protocol` (`Progress`). `packages/client-core` depends on both, and its barrel `packages/client-core/src/index.ts` ends with the `./store/ai-cards` export block.
2. **`parseInviteCode(raw)`.** It's identical in `apps/web/src/components/auth/InviteCodeField.tsx:7-11` and `apps/mobile/src/auth/InviteCodeField.tsx:7-11`. `packages/chat-core/src/index.ts` ends with `export * from './person-link';`.
3. **The computer choices.**
   - `computerChoices(cloud, hasMachine)` returns the four choices off, cloud, runner and auto, with the same labels, descriptions and disabled rules. It's in `apps/mobile/src/components/ais/computer-picker.tsx:12-59` (132 lines, with an `icon` field and `type ComputerMode`) and `apps/web/src/components/ais/AiComputerSection.tsx:14-60` (140 lines, `AiComputerMode`).
   - Phone users of `ComputerMode`: `use-computer-mode.ts:8`, `new-ai/setup-step.tsx:5` and `new-ai/use-new-ai-flow.ts:15`, all under `apps/mobile/src/components/ais/`.

### Steps
1. **Steps.** Create `packages/client-core/src/task-steps.ts` with:
   - `DisplayStep`, `toDisplayStep`, and `fallbackSteps(card: Progress | undefined)`;
   - `stepsView(loaded: readonly TaskStep[] | undefined, failureStatus: number | undefined, card: Progress | undefined): { steps; loading; errored }`;
   - `defaultOpenStepId(steps): string | null`.

   Append ONE export line at the **end** of the client-core barrel. Both step views use these, and keep their own sheet, row markup and toggle state.
2. **Invite code.** Create `packages/chat-core/src/invite-code.ts` with `parseInviteCode` and its comment. Append ONE `export * from './invite-code';` at the **end** of the chat-core barrel. Both `InviteCodeField.tsx` files import it, and their `parseInviteCode` export stays as a re-export so importers don't change.
3. **Computer choices.** Create `packages/chat-core/src/ai-computer.ts` with `type ComputerMode = 'off' | 'cloud' | 'runner' | 'auto'` and `computerChoices(cloud, hasMachine)`, returning `{ mode, label, description, disabled }` with no icon. Append ONE export line at the end of the chat-core barrel, after step 2's line.
   - Each app maps mode to its own icon with a small `Record<ComputerMode, Icon>`.
   - The phone's `ComputerMode` export in `computer-picker.tsx` stays as a re-export, so the three importers don't change.
   - If web's `AiComputerMode` is a contract type with the same four values, keep using it.
4. **No new tests.** Report the line counts; product lines must go down. Each file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/task-steps.ts`
- `packages/client-core/src/index.ts`
- `packages/chat-core/src/invite-code.ts`
- `packages/chat-core/src/ai-computer.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/StepsPanel.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx`
- `apps/web/src/components/auth/InviteCodeField.tsx`
- `apps/mobile/src/auth/InviteCodeField.tsx`
- `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/mobile/src/components/ais/computer-picker.tsx`
- `work/T-2066-shared-twin-logic.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines go down.
- **Lead check, web mock:**
  - an AI's Steps panel opens with its steps;
  - the AI settings computer section shows the four choices with the same descriptions.
- **Lead check, phone emulator:** the Steps sheet opens.

---

## Report (written by the worker when done)

### What I did

Moved the three copied pieces into shared packages; each app keeps only its icons and markup.

- **Steps view model** — new `packages/client-core/src/task-steps.ts` (65 lines): `DisplayStep`, `toDisplayStep`, `fallbackSteps(card: Progress | undefined)`, `stepsView(loaded, failureStatus, card)` (loaded → mapped steps; gone on 404 or empty → card fallback; otherwise `[]`; `loading` = no data and no failure; `errored` = non-404 failure) and `defaultOpenStepId(steps)`. Appended one `export * from './task-steps';` at the end of the client-core barrel.
  - `apps/web/src/components/StepsPanel.tsx`: 291 → 250 lines; the sheet, rows and toggle state stay.
  - `apps/mobile/src/components/chat/steps-sheet.tsx`: 306 → 264 lines; the sheet and its reset-on-close stay.
- **Invite code** — new `packages/chat-core/src/invite-code.ts` (9 lines) with `parseInviteCode` and its comment. Appended one `export * from './invite-code';` at the end of the chat-core barrel.
  - Both `InviteCodeField.tsx` files import it and re-export it (`export { parseInviteCode };`), so their importers are unchanged.
- **Computer choices** — new `packages/chat-core/src/ai-computer.ts` (45 lines): `type ComputerMode = 'off' | 'cloud' | 'runner' | 'auto'`, `ComputerChoice` (`mode`, `label`, `description`, `disabled`) and `computerChoices(cloud, hasMachine)`. Appended one `export * from './ai-computer';` after the invite-code line.
  - `apps/web/src/components/ais/AiComputerSection.tsx`: 140 → 99 lines; maps modes with `COMPUTER_ICONS: Record<ComputerMode, LucideIcon>`, keeps `AiComputerMode` from `@zilar/api-contract` for the save action.
  - `apps/mobile/src/components/ais/computer-picker.tsx`: 132 → 91 lines; maps modes the same way and keeps `export type { ComputerMode } from '@zilar/chat-core'`, so `use-computer-mode.ts`, `new-ai/setup-step.tsx` and `new-ai/use-new-ai-flow.ts` are unchanged.

No tests were added, per the spec (step 4). All changed source files are under 400 lines.

### Checks run

- `pnpm install --frozen-lockfile` — completed, 12.5s.
- No single test files were run: no test files were touched, and the spec says no new tests; the gate ran the three affected suites.
- `pnpm gate` — ended with `GATE PASS`:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (0.9s)
PASS  lint  (2.1s)
PASS  typecheck  (11.2s)
PASS  effect  (1.4s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/chat-core  (3.0s)
PASS  tests @zilar/client-core  (6.1s)
PASS  tests @zilar/mobile  (4.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Product lines: web Steps 291→250, phone steps sheet 306→264, web computer section 140→99, phone picker 132→91; shared logic is 65 + 9 + 45 lines in packages.
- `stepsView` takes `failureStatus` rather than the failure object, so both apps keep their own `failureOf` handling.
- The phone's `fallbackSteps` used to take a non-optional `Progress`; the shared one takes `Progress | undefined` as the web one did, which is the safe superset (phone still passes its card).
- I did not run the web mock or the phone emulator; those are the lead's checks.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.**
  - `task-steps.ts` in client-core: `stepsView`, `defaultOpenStepId` and the display step helpers.
  - `parseInviteCode` and `computerChoices` in chat-core.
  - Each app keeps only its icons and markup.
- **Size.** −57 product lines.
- **Lead Playwright check** (web mock, :5200):
  - `/c/ai-dev-1@zilar.test?steps=t-21` opens Steps with all 6 steps, and the failed "pnpm test" action is expanded by default;
  - the Dev-1 AI panel shows the computer choices "No computer", "Runs on a Zilar cloud computer" and "Runs on your home machine";
  - no console errors.
- **Not checked:** the phone Steps sheet on the emulator. It uses the same pure helpers, and typecheck plus the gate pass.
