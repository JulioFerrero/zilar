---
id: T-0986
title: "Size split T30: apps/mobile/src/components/chat/composer.tsx (788 lines) into chat/{composer-media,composer-sheet,use-composer-mentions,composer-input-row}; one captionOptions + clearDraft"
status: merged
milestone: M5
branch: task/T-0986-split-mobile-composer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0986: Split the mobile composer

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/composer.tsx` is 788 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #26 (task T30): `components/chat/composer-media.ts`, `chat/composer-sheet.ts`, `chat/use-composer-mentions.ts`, `chat/composer-input-row.tsx`, under `apps/mobile/src/`. `composer.tsx` keeps the `Composer` and every export it has today.

- **Existing file:** `components/chat/composer-mentions.ts` already exists. Leave it as it is, and import from it if you need to.
- **In scope:** the in-file Dedup. `sendGif` and `handleSend` share one `captionOptions(text, replyTo)` and one `clearDraft()`.
- **Same behaviour:** this is the message send path, so the message options sent must stay exactly the same.

The lead runs a phone smoke of a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #26, and `apps/mobile/src/components/chat/composer.tsx`.

### Allowed files
`apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/composer-sheet.ts`, `apps/mobile/src/components/chat/use-composer-mentions.ts`, `apps/mobile/src/components/chat/composer-input-row.tsx`, `work/T-0986-split-mobile-composer.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/components/chat/composer.tsx` following `docs/audit/split-rules.md` and the plan entry `docs/audit/size-plan.md` §2.2 #26 (T30). The four new files hold the same code as hooks/component; `composer.tsx` keeps `Composer` and re-exports `fieldHeightFor`, so `chat-composer-dock.tsx` (the only importer) is unchanged.

- `composer-input-row.tsx` — `ReplyBar`, `fieldHeightFor`/`MIN_INPUT_HEIGHT`, and the new `ComposerInputRow` (the input row JSX + the send button + `useKeyPress`).
- `use-composer-mentions.ts` — the `@` mention state/tracking, `handleChange`, `pickMention`, the chat-key reset and the emoji-insert retrack.
- `composer-sheet.ts` — the emoji/sticker/GIF sheet wiring (`useComposerSheet`): packs, recents, GIF probe, sheet tab and the pick handlers.
- `composer-media.ts` — attachments + GIF send (`useComposerMedia`): picker/GIF-downloader seams, the pick action, `sendGif`, `pickGif`, the picked-file send; also hosts the shared `step`/`ComposerStepFailed` used by the sheet, and the dedup helpers.

**Dedup (in scope):** added `captionOptions(text, replyTo)` and `clearDraft()` in `composer-media.ts`; they replace the duplicated option object + clear block in `sendGif` and in the picked-file branch of `handleSend` (now `sendPicked`). `clearDraft()` is created in `composer.tsx` (it needs `setText`/`setInputHeight`/`onCancelReply`) and passed into the media hook. No other code changed behaviour.

### Files changed (all inside Allowed files)

`wc -l` on base `main` and now:

| file | before | after |
| --- | ---: | ---: |
| `components/chat/composer.tsx` | 788 | 275 |
| `components/chat/composer-media.ts` | — | 251 |
| `components/chat/composer-sheet.ts` | — | 227 |
| `components/chat/use-composer-mentions.ts` | — | 160 |
| `components/chat/composer-input-row.tsx` | — | 170 |

Every file is under the 400-line cap.

### Export diff (split-rules item 8)

Before, on `main` (`git show main:…/composer.tsx | grep -E "^export"`):
```
93:export function fieldHeightFor(contentHeight: number): number {
175:export function Composer({
```
After (`grep -nE "^export"` on the barrel + new files):
```
composer.tsx:30:export { fieldHeightFor } from '@/components/chat/composer-input-row';
composer.tsx:61:export function Composer({
composer-media.ts:18:export class ComposerStepFailed …
composer-media.ts:27:export function step<A>(…)
composer-media.ts:51:export function captionOptions(…)
composer-media.ts:64:export function useComposerMedia(…)
composer-sheet.ts:31:export function useComposerSheet(…)
use-composer-mentions.ts:22:export function useComposerMentions(…)
composer-input-row.tsx:20:export const MIN_INPUT_HEIGHT = 36;
composer-input-row.tsx:31:export function fieldHeightFor(…)
composer-input-row.tsx:42:export function ReplyBar(…)
composer-input-row.tsx:89:export function ComposerInputRow(…)
```
The barrel keeps the same two names and kinds it exported before: `Composer` (value) and `fieldHeightFor` (value). The new names are the modules' own hooks/helpers.

### Commands and real results

- `pnpm install` — done (1172 added, reused 1141; the `@types/react` peer warning is pre-existing).
- `pnpm exec prettier --write` on the five task files — formatting of my files only (the gate's format step is a read-only `prettier --check`, so the files must be written). Then `prettier --check` on them passed.
- `pnpm gate` (repo root), summary:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.0s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (1.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
- The task's standalone check `pnpm --filter @zilar/mobile typecheck` was **not** run on its own: the gate's `typecheck` step runs `turbo run typecheck --affected --base main`, and a dry run (`TURBO_SCM_BASE=main pnpm exec turbo run typecheck --affected --dry=json`) confirmed the set is exactly `@zilar/mobile typecheck`, which the gate reports PASS.
- No test files sit near the composer (`SKIP tests @zilar/mobile`): no single test run was needed, and none was skipped by the gate.

### Effect ratchet

No `// effect-plain:` marker was added. `composer-media.ts` and `composer-sheet.ts` import `effect` as a value (`Effect`), so they classify `effect`. `use-composer-mentions.ts` and `composer-input-row.tsx` hold no Promise/IO/`process.env`/storage code, so they classify `plain`. The gate's `effect` step passed.

### Deviations / notes

- The plan's line ranges are cross-cutting (state and handlers are interleaved), so the moved code is grouped into hooks that return state + handlers; `composer.tsx` remains the coordinator that renders the sheets and the input row. No behaviour changed: same state, same handlers, same JSX, same order of the render-time seeding/reset.
- `step`/`ComposerStepFailed` are shared by the media and sheet code; they live in `composer-media.ts` and `composer-sheet.ts` imports `step` from it (one direction, no cycle). A fifth shared file was not in the plan, so this keeps to the four named files.
- I ran a scoped `prettier --write` on only the five task files (not the repo-wide `pnpm format` the lead asked workers to avoid); it was required to make the gate's `prettier --check` pass.

### Security checklist

UI-only change (message composer). No auth, keys, permissions, money, routes, logging or DB access is touched, so no item on the checklist applies. The message send path is byte-for-byte the same options (`captionOptions`) and the same store calls as before.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `composer.tsx` (788 lines) is now 271 lines, plus `composer-media` (248), `composer-sheet`, `use-composer-mentions` and `composer-input-row`. One `captionOptions` and one `clearDraft` serve both sends.
- **The lead's phone smoke** (mock build, Dev team › General): typing "Smoke test from T-0986" and tapping Send shows my bubble with its check. The draft field empties, and the mock Dev-1 replies.
- **Check:** the gate passed.
