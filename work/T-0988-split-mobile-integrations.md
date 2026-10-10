---
id: T-0988
title: "Size split T38: apps/mobile/src/app/settings/integrations.tsx (740 lines) into components/integrations/{card-fields,email-card,voice-card,telegram-card,use-card-actions}"
status: merged
milestone: M5
branch: task/T-0988-split-mobile-integrations
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0988: Split the mobile integrations screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/integrations.tsx` is 740 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #34 (task T38). The new files go in `apps/mobile/src/components/integrations/`:
- `card-fields.tsx`, `email-card.tsx`, `voice-card.tsx`, `telegram-card.tsx`;
- `use-card-actions.ts`.

The screen keeps the loader and the wiring of the three cards.

- **Existing files:** the folder already holds `card-save.ts`, `errors.ts`, `integrations-mock.ts` and `use-integrations-api.ts`. Leave them as they are.
- **In scope:** the in-file Dedup. `use-card-actions.ts` holds one save state machine and one remove state machine, used by all three cards.
- **Same behaviour:** each card keeps its own texts and fields. A saved secret must still never be shown back in the field, so keep `SecretField` exactly as it is.

The lead runs a phone smoke of `/settings/integrations` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #34, `apps/mobile/src/app/settings/integrations.tsx`, and `apps/mobile/src/components/integrations/card-save.ts`.

### Allowed files
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/components/integrations/card-fields.tsx`, `apps/mobile/src/components/integrations/email-card.tsx`, `apps/mobile/src/components/integrations/voice-card.tsx`, `apps/mobile/src/components/integrations/telegram-card.tsx`, `apps/mobile/src/components/integrations/use-card-actions.ts`, `work/T-0988-split-mobile-integrations.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**Status:** done (gate green, no behaviour change intended).

### What I did

Split `apps/mobile/src/app/settings/integrations.tsx` (740 `wc -l`) per `docs/audit/size-plan.md` §2.2 #34, following `docs/audit/split-rules.md`:

- `components/integrations/card-fields.tsx` — the five shared presentational pieces (`CardHeader`, `SecretField`, `SaveButton`, `RemoveButton`, `RemoveConfirmDialog`), moved unchanged from lines 154–299.
- `components/integrations/email-card.tsx` — `EmailCard` (301–424), now a named export.
- `components/integrations/voice-card.tsx` — `VoiceCard` (426–596).
- `components/integrations/telegram-card.tsx` — `TelegramCard` (598–740).
- `components/integrations/use-card-actions.ts` — the in-file Dedup: one save state machine (`useCardSave`) replacing the three save blocks, one remove state machine (`useCardRemove`) replacing the two remove blocks.
- `apps/mobile/src/app/settings/integrations.tsx` — keeps the loader and the three-card wiring (52–152) as the default export; imports the three cards.

The old file's only export was the default screen; nothing else imports it (the route is reached via `apps/mobile/src/lib/settings-items.ts`), so no barrel was needed — the screen itself stays the route entry point, which is what the plan asks for. Existing files in the folder (`card-save.ts`, `errors.ts`, `integrations-mock.ts`, `use-integrations-api.ts`) were left untouched.

**Behaviour:** no change intended. Each card keeps its own texts, fields and validation sentence; `SecretField` is byte-for-byte as before. `use-card-actions.ts` `card-fields`'s comments were generalised where the three copies differed only by the word "key"/"token". The `if (busy) return;` guards are kept in each card, so the double-press behaviour is unchanged.

### Sizes (`wc -l`)

| file | lines |
| --- | --- |
| `app/settings/integrations.tsx` (old) | 740 |
| `app/settings/integrations.tsx` (new) | 140 |
| `components/integrations/card-fields.tsx` | 163 |
| `components/integrations/email-card.tsx` | 126 |
| `components/integrations/voice-card.tsx` | 150 |
| `components/integrations/telegram-card.tsx` | 122 |
| `components/integrations/use-card-actions.ts` | 148 |

Every file is under 400.

### Exports before / after (`grep -E "^export"`)

Before (`git show main:apps/mobile/src/app/settings/integrations.tsx`):

```text
export default function IntegrationsScreen() {
```

After — screen unchanged, new files add the moved pieces:

```text
app/settings/integrations.tsx
export default function IntegrationsScreen() {

card-fields.tsx
export function CardHeader({
export function SecretField({
export function SaveButton({
export function RemoveButton({
export function RemoveConfirmDialog({

email-card.tsx
export function EmailCard({

voice-card.tsx
export function VoiceCard({

telegram-card.tsx
export function TelegramCard({

use-card-actions.ts
export interface CardSecret {
export interface CardSaveActions<Draft> {
export function useCardSave<Draft>({
export interface CardRemoveActions {
export function useCardRemove({
```

The old file's public export (the default screen) is unchanged; the internal components become named exports of the new files — the expected shape for a split with no external importers.

### Commands run

- `pnpm install` — done, 1262 resolved, no errors (one pre-existing peer-dependency warning on `@types/react-dom`/`@types/react`).
- `pnpm --filter @zilar/mobile typecheck` (`tsc --noEmit`) — passed, no output.
- `pnpm gate` — first run FAILed only the `format` step on `voice-card.tsx` (`[warn] Code style issues found`). Fixed with `pnpm exec prettier --write apps/mobile/src/components/integrations/voice-card.tsx`, then re-ran. Final gate summary:

```text
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.6s)
PASS  lint  (1.0s)
PASS  typecheck  (4.2s)
PASS  effect  (2.0s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

I did not run a separate single test file: the package has no test near these files (`find` found none in `components/integrations` or `app/settings`), and the gate's nearest-test step selected none. No new tests were written (per `split-rules.md` item 5).

### Effect ratchet

`PASS effect`. No `// effect-plain:` marker was needed: `use-card-actions.ts` imports `effect` as a value, so the map classifies it `effect`; the four card/field files have no hard or weak signals, so they classify `plain`. No markers added.

### Deviations / notes

- Generalised the save/remove doc-comment wording (was per-card "key"/"token") now that the machine is shared; no code behaviour change.
- The removed blocks live in `useCardRemove`, which takes an `onRemoved` callback so the Voice/Telegram cards still clear the save's "Saved." line on a successful remove (the original `setSaved(false)`), keeping the save and remove machines in one per-card pair.
- No new dependencies, no `any`, no `@ts-ignore`.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `settings/integrations.tsx` (740 lines) becomes the screen plus `components/integrations/{card-fields,email-card,voice-card,telegram-card,use-card-actions}`. One save and one remove state machine serve all three cards.
- **The lead's phone smoke** (mock build, `/settings/integrations`):
  - Email (Connected), Voice transcription (Not set up) and Telegram bot (Connected) render, and every secret field is empty with only a placeholder;
  - Save on Email shows "Saved. A test email is on its way to your address.";
  - Remove on Telegram asks "Remove the Telegram token?", and confirming shows "Not set up" and hides Remove.
- **Check:** the gate passed.
