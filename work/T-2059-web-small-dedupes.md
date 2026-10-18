---
id: T-2059
title: "Reduce (web): shownFailure lives once in client-core next to failureOf (13 web copies go), aiFailureText once in components/ais/errors.ts, one step-state icon for ProgressCard and StepsPanel, and one 'Content' list (media, pins, activity, always allowed) for group and channel info — same UI"
status: merged
milestone: M5
branch: task/T-2059-web-small-dedupes
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2059: Web small dedupes

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code and share components. The lead's jscpd run and a `git grep` (2026-10-18) found four web helpers or components copied.

### Facts (read by the lead on 2026-10-18 at `c4c8d733e`)
1. **`shownFailure`.** It's `isWaiting(state) ? undefined : failureOf(state)`, with a one-line comment, defined **13 times**, in these files under `apps/web/src/`:
   - `components/GifPanel.tsx:93`
   - `components/ais/AiHealthRow.tsx:22`
   - `components/connections/ConnectionRow.tsx:23`
   - `components/connections/ReplaceKeyForm.tsx:17`
   - `components/machines/machineRowOps.ts:26`
   - `components/settings/integrationErrors.ts:15`, which is exported
   - `routes/AisPage.tsx:20`
   - `routes/BlockedPage.tsx:130`
   - `routes/ConnectionsPage.tsx:17`
   - `routes/ContactsPage.tsx:219`
   - `routes/DevicesPage.tsx:240`
   - `routes/RequestsPage.tsx:189`

   `failureOf` and `isWaiting` live in `packages/client-core/src/use-action.ts:61,67`. They're exported by `packages/client-core/src/index.ts:11`, `export { failureOf, isWaiting, makeUseAction } from './use-action';`, and re-exported for web by `apps/web/src/lib/effect/use-action.ts:6`.
2. **`aiFailureText(failure, fallback)`.** It's identical in `apps/web/src/components/ais/AiHealthRow.tsx:30-38` and `apps/web/src/routes/AisPage.tsx:28-36`. Both call `describeAiError` from `apps/web/src/components/ais/errors.ts` (14 lines).
3. **The step-state icon.** `StepIcon` in `apps/web/src/components/ProgressCard.tsx:65-93` (used at `:251`, icon class `size-3.5`) and `StepStateIcon` in `apps/web/src/components/StepsPanel.tsx:86-114` (used at `:135`, `size-4`) are the same: done is a check, failed is an X, doing is a spinner that respects reduced motion, otherwise a circle.
4. **The Content nav.** The "Content" `<nav>` is the same in two files:
   - `apps/web/src/components/channel-info/ChannelInfoRoot.tsx:271-305` (363 lines);
   - `apps/web/src/components/group-info/GroupInfoRoot.tsx:210-251` (279 lines).

   It holds Shared media, Pinned messages with a count, and Activity plus Always allowed for managers. Group info adds a "Tools and routines" row after Pinned messages.

### Steps
1. **`shownFailure`.**
   - Add `shownFailure` to `packages/client-core/src/use-action.ts`, next to `failureOf`.
   - Add it to the **existing** export line `packages/client-core/src/index.ts:11`; don't add a new line.
   - Re-export it from `apps/web/src/lib/effect/use-action.ts:6`.
   - Delete all 13 copies and import it from `@/lib/effect/use-action`. Keep `integrationErrors.ts`'s export as a re-export only if other files import it from there; check with `git grep`.
2. **`aiFailureText`.** Move it to `apps/web/src/components/ais/errors.ts`, and use it in both files.
3. **The step icon.** Export one `StepStateIcon({ state, reduceMotion, className })` from `StepsPanel.tsx`. `ProgressCard.tsx` uses it with `size-3.5`.
4. **The Content nav.** Create `apps/web/src/components/group-info/ContentNav.tsx`, taking `{ chatId, pinCount, isManager, onOpenMedia, onOpenPage, extraRow?: ReactNode }`. Both roots use it; group info passes its Tools row as `extraRow`.
5. **No tests** (UI). Report the line counts; product lines must go down by at least 60. Each file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/use-action.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/effect/use-action.ts`
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/ais/AiHealthRow.tsx`
- `apps/web/src/components/ais/errors.ts`
- `apps/web/src/components/connections/ConnectionRow.tsx`
- `apps/web/src/components/connections/ReplaceKeyForm.tsx`
- `apps/web/src/components/machines/machineRowOps.ts`
- `apps/web/src/components/settings/integrationErrors.ts`
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/routes/BlockedPage.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ContactsPage.tsx`
- `apps/web/src/routes/DevicesPage.tsx`
- `apps/web/src/routes/RequestsPage.tsx`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/StepsPanel.tsx`
- `apps/web/src/components/group-info/ContentNav.tsx`
- `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `work/T-2059-web-small-dedupes.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines are at least 60 lower.
- **Lead check, web mock:** group info and channel info show the same Content rows as before; an AI progress card shows its step icons.

---

## Report (written by the worker when done)

### What I did

- **`shownFailure`**: added to `packages/client-core/src/use-action.ts` next to `failureOf`, added to the existing export line in `packages/client-core/src/index.ts`, and re-exported from `apps/web/src/lib/effect/use-action.ts`. Deleted the local copies in GifPanel, AiHealthRow, ConnectionRow, ReplaceKeyForm, machineRowOps, AisPage, BlockedPage, ConnectionsPage, ContactsPage, DevicesPage and RequestsPage; each now imports it from `@/lib/effect/use-action`. `components/settings/integrationErrors.ts` keeps only a re-export because `EmailCard`, `TelegramCard` and `VoiceTranscriptionCard` import it from there.
- **`aiFailureText`**: moved into `apps/web/src/components/ais/errors.ts`; `AiHealthRow.tsx` and `AisPage.tsx` now import it. Removed the imports they no longer needed (`AsyncResult`, `ApiError`, `ApiFailure`, `describeAiError`).
- **Step icon**: exported `StepStateIcon({ state, reduceMotion, className = 'size-4' })` from `StepsPanel.tsx`; `ProgressCard.tsx` uses it with `className="size-3.5"` and its old `StepIcon` is gone.
- **Content nav**: added `apps/web/src/components/group-info/ContentNav.tsx` with the props from the spec and used it in both `ChannelInfoRoot.tsx` and `GroupInfoRoot.tsx`; group info passes its "Tools and routines" row as `extraRow`, so it still sits after Pinned messages.
- Changed files: `packages/client-core/src/{use-action,index}.ts`, `apps/web/src/lib/effect/use-action.ts`, the 11 web files listed above for `shownFailure`, `apps/web/src/components/ais/errors.ts`, `apps/web/src/components/ProgressCard.tsx`, `apps/web/src/components/StepsPanel.tsx`, `apps/web/src/components/group-info/ContentNav.tsx` (new), `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`, `apps/web/src/components/group-info/GroupInfoRoot.tsx`, plus this task file.

Line counts (product code only, `packages/client-core/src` + `apps/web/src`): 148 insertions, 240 deletions, **net -92 lines** (the new `ContentNav.tsx` is 63 of the insertions). File sizes: `ProgressCard.tsx` 246, `StepsPanel.tsx` 291, `ChannelInfoRoot.tsx` 334, `GroupInfoRoot.tsx` 246, `ContentNav.tsx` 63 — all at or under 400.

### Checks run

- `pnpm gate`: `GATE PASS`. Summary lines:

```
gate: 22 changed file(s) against main
PASS  install (frozen)  (4.3s)
PASS  format  (4.4s)
PASS  lint  (3.0s)
PASS  typecheck  (11.0s)
PASS  effect  (2.4s)
PASS  build @zilar/server  (0.9s)
PASS  tests @zilar/client-core  (7.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single test files: none run separately (UI-only change, per the spec). The gate ran `tests @zilar/client-core` and skipped `@zilar/web` because it found no nearby test files.

### Notes for the lead

- **Deviation, deliberate:** the spec describes the shared step icon's fallback as "otherwise a circle", but the old `StepStateIcon` in `StepsPanel` drew a **square** for `stopped` while `ProgressCard`'s `StepIcon` drew a **circle** for `planned`. To keep both views pixel-identical I made the shared icon explicit: `stopped` → square, everything else → circle. It is still one component with one spinner/check/X behaviour; if you prefer a single circle fallback, it is a two-line change but `stopped` rows in StepsPanel would change shape.
- `integrationErrors.ts` exports `shownFailure` as a re-export (not a moved definition) because three settings cards still import it from there; changing those imports would have touched files outside the Allowed list.
- Nothing was pushed or merged.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.**
  - `shownFailure` lives in client-core, and the 12 web copies are gone.
  - `aiFailureText` is in `ais/errors.ts`.
  - There is one `StepStateIcon`.
  - One `ContentNav` serves group and channel info.
- **Size.** −92 product lines.
- **Lead Playwright check** (web mock, :5197):
  - Dev team group info's Content nav reads Shared media, Pinned messages 0, Tools and routines, Activity, Always allowed, the same order as before;
  - the topic info panel is unchanged;
  - no console errors.
