---
id: T-1000
title: "Size split T69: apps/web/src/routes/IntegrationsPage.tsx (548 lines) into components/settings/{integrationErrors,EmailCard,VoiceTranscriptionCard,TelegramCard,useIntegrationSave}"
status: merged
milestone: M5
branch: task/T-1000-split-web-integrations-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1000: Split `IntegrationsPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/IntegrationsPage.tsx` is 548 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #65 (task T69). The new files go in a new `apps/web/src/components/settings/` folder: `integrationErrors.ts`, `EmailCard.tsx`, `VoiceTranscriptionCard.tsx` and `TelegramCard.tsx`. The page keeps the loader and every export it has today.

- **In scope:** the in-file Dedup. The three cards' "clear error → save → clear input → reload → `onSaved`" skeleton becomes one `useIntegrationSave`, in `components/settings/useIntegrationSave.ts`.
- **Same behaviour:** each card keeps its own texts and fields, and a saved secret is never shown back.

The lead checks it in Chrome in mock mode: the email card's save, and the Telegram card's remove.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #65, and `apps/web/src/routes/IntegrationsPage.tsx`.

### Allowed files
`apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/components/settings/integrationErrors.ts`, `apps/web/src/components/settings/EmailCard.tsx`, `apps/web/src/components/settings/VoiceTranscriptionCard.tsx`, `apps/web/src/components/settings/TelegramCard.tsx`, `apps/web/src/components/settings/useIntegrationSave.ts`, `work/T-1000-split-web-integrations-page.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names the page's route.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/routes/IntegrationsPage.tsx` (548 lines) per `docs/audit/size-plan.md` §2.2 #65 and `docs/audit/split-rules.md`. The page keeps the loader and its only export, `IntegrationsPage`; the three cards and their shared error helpers moved to the new `apps/web/src/components/settings/` folder. The page's route is `/settings/integrations` (`apps/web/src/routes/AppRoutes.tsx:240`).

The in-file dedup is done: the repeated "validate → `fromApi` write → clear input → reload → patch `onSaved`" skeleton of the three cards is now one `useIntegrationSave` hook, wrapping `useAction`. Each card keeps its own texts, fields, validation sentence and page patch; no saved secret is shown back (no `configured`/secret value is rendered, as before).

### Files changed

- `apps/web/src/routes/IntegrationsPage.tsx` (edited, now a thin page/barrel)
- `apps/web/src/components/settings/integrationErrors.ts` (new)
- `apps/web/src/components/settings/useIntegrationSave.ts` (new)
- `apps/web/src/components/settings/EmailCard.tsx` (new)
- `apps/web/src/components/settings/VoiceTranscriptionCard.tsx` (new)
- `apps/web/src/components/settings/TelegramCard.tsx` (new)
- `work/T-1000-split-web-integrations-page.md` (this report)

No file outside the Allowed files was touched (`git status`: the page, this task file, and the new `components/settings/` folder only).

### wc -l (before → after)

- before: `apps/web/src/routes/IntegrationsPage.tsx` 548
- after:
  - `apps/web/src/routes/IntegrationsPage.tsx` 98
  - `apps/web/src/components/settings/integrationErrors.ts` 45
  - `apps/web/src/components/settings/useIntegrationSave.ts` 46
  - `apps/web/src/components/settings/EmailCard.tsx` 121
  - `apps/web/src/components/settings/VoiceTranscriptionCard.tsx` 171
  - `apps/web/src/components/settings/TelegramCard.tsx` 115

Every file is under the 400-line limit (max 171).

### Exports before and after

Before (`git show HEAD:apps/web/src/routes/IntegrationsPage.tsx | grep -nE "^export"`):

```
76:export function IntegrationsPage() {
```

After (barrel + new files, `grep -nE "^export"`):

```
apps/web/src/routes/IntegrationsPage.tsx:29:export function IntegrationsPage() {
apps/web/src/components/settings/integrationErrors.ts:7:export type PageStatus = 'loading' | 'ready' | 'forbidden';
apps/web/src/components/settings/integrationErrors.ts:10:export class SenderMissing extends Data.TaggedError('SenderMissing') {}
apps/web/src/components/settings/integrationErrors.ts:11:export class EndpointMissing extends Data.TaggedError('EndpointMissing') {}
apps/web/src/components/settings/integrationErrors.ts:12:export class TokenMissing extends Data.TaggedError('TokenMissing') {}
apps/web/src/components/settings/integrationErrors.ts:15:export function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
apps/web/src/components/settings/integrationErrors.ts:19:export function friendlyError(error: ApiFailure): string {
apps/web/src/components/settings/EmailCard.tsx:10:export function EmailCard({
apps/web/src/components/settings/VoiceTranscriptionCard.tsx:23:export function VoiceTranscriptionCard({
apps/web/src/components/settings/TelegramCard.tsx:12:export function TelegramCard({
apps/web/src/components/settings/useIntegrationSave.ts:8:export interface IntegrationSave<Op, Value, ValidationError> {
apps/web/src/components/settings/useIntegrationSave.ts:28:export function useIntegrationSave<Op, Value, ValidationError>(
```

The route file still exports exactly what it did before: `IntegrationsPage` (value). The extra names live in the new modules and were private functions before, so no importer changes; the new modules are also each self-contained (`EmailCard`/`VoiceTranscriptionCard`/`TelegramCard` had no other importers).

### Dedup (in-file)

The three cards' save/remove skeleton now runs through one `useIntegrationSave` (46 lines). Each card passes the small per-card pieces: the API `write`, its own `validate` (returning its tagged error), the secret `clearInput`, the `onSaved` page patch and the success `value`. The removed copy-count is ~50 lines across the three pipes; behaviour is unchanged, including:
- Email success line on any success, and `asVoid` (now `value: () => undefined`);
- Voice/Telegram success line only when the action resolved `'saved'` (remove resolves `'removed'`);
- the reload stays inside the action, so a failed reload still fails the action and no success line shows;
- each card's own error sentence for its validation error (`SenderMissing` / `EndpointMissing` / `TokenMissing`).

### Effect ratchet

`PASS effect`. `integrationErrors.ts` and `useIntegrationSave.ts` import `effect`/`Data` as a value, so they classify `effect`. The three card files import `AsyncResult` (`effect/reactivity`) as a value, so they also classify `effect`; the page no longer imports an `effect` value, so it classifies `plain` (the ratchet only fails `needs-effect`). No `// effect-plain:` marker was added.

### Commands run (real results)

- `pnpm install`: done in 37.5s (one pre-existing peer warning on `@types/react-dom`/`@types/react`).
- `pnpm --filter @zilar/web build`: `✓ built in 936ms`, no errors (only the pre-existing chunk-size warning).
- `pnpm gate` (first run): `GATE FAIL` — `FAIL format` on `TelegramCard.tsx` and `useIntegrationSave.ts`; `scope: every changed file is inside the Allowed files`. Fixed with `pnpm exec prettier --write` on those two files.
- `pnpm gate` (second run):

```text
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.4s)
PASS  lint  (1.1s)
PASS  typecheck  (3.7s)
PASS  effect  (0.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: `@zilar/web` has no test near these files, and the gate's nearest-test step selected none (`SKIP`). Per `split-rules.md` item 5 no tests were written or edited (`IntegrationsPage` is UI code, no tests at all).

### Deviations / notes

- `PageStatus` moved to `integrationErrors.ts` with the plan's line range 23–61; the file therefore holds the page-status type as well as the error classes/helpers. Its name still reads best as "the page's integration error/status plumbing". If the lead prefers `PageStatus` to stay in the page, it is a one-line move.
- The cards no longer build the Effect themselves (the pipe moved into the hook), so the page lost its `Data`/`Effect` value imports; this is the intended dedup, not a behaviour change.
- Voice/Telegram keep their local `VoiceOp`/`TelegramOp` unions unchanged; the hook is generic over the op, so no shared op type was introduced.
- No new dependencies, no `any`, no `@ts-ignore`.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `IntegrationsPage.tsx` (548 lines) becomes the page plus `components/settings/{integrationErrors,EmailCard,VoiceTranscriptionCard,TelegramCard,useIntegrationSave}`, the largest `VoiceTranscriptionCard.tsx` at 171.
- **No Chrome check possible:** web mock mode shows "Only the person who runs this server can change integrations", on main too, so the cards don't render there.
- **The lead read the hook instead:** `useIntegrationSave` runs validate, then write, then clears the input, reloads the status and calls `onSaved`, in the same order as main's email save (`IntegrationsPage.tsx:157-182` on main). `EmailCard` shapes `{ from, resendApiKey? }` exactly as before.
- **Check:** the gate passed, and so did the web build.
