---
id: T-2154
title: "Merge back small sibling splits (chat-core AI, avatar and emoji pieces, api-contract lenient, protocol handoff line, web dialog stepper, devtools watch format): fewer files, imports and re-export lines; no behaviour change"
status: merged
milestone: M5
branch: task/T-2154-merge-sibling-splits
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2154: Merge small sibling splits back into their base file

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: 400 lines is a soft limit, and files split only for size may be merged back when that saves lines. Each row below is a base file plus siblings named `<base>-<part>` that are small and imported together, so each merge removes import lines, `index.ts` re-export lines and repeated types. The lead listed them at `a11878682`. Every merged file stays under 650 lines.

| # | Merge these | Into | Notes |
| --- | --- | --- | --- |
| 1 | `packages/chat-core/src/ai-activity.ts`, `ai-computer.ts`, `ai-errors.ts`, `ai-form.ts`, `ai-health.ts`, `ai-limits.ts`, `ai-models.ts`, `ai-providers.ts`, `ai-suggestions.ts`, `ai-templates.ts` (about 510 lines together) | `packages/chat-core/src/ai.ts` (2 lines today) | Drop their 10 `export * from './ai-…'` lines in `packages/chat-core/src/index.ts`; `export * from './ai'` stays. `ai-limits.ts` and `ai-templates.ts` import types from `./ai-form`; those imports go away. |
| 2 | `packages/chat-core/src/avatar-seed.ts` (13), `avatar-identity.ts` (40) | `packages/chat-core/src/avatar.ts` (60) | Drop their two `index.ts` lines. |
| 3 | `packages/chat-core/src/emoji-table.ts` (31) | `packages/chat-core/src/emoji.ts` (19) | Drop its `index.ts` line. `emoji-names.ts` (361 lines of data) stays its own file. |
| 4 | `packages/api-contract/src/lenient-nullable-string.ts` | `packages/api-contract/src/lenient.ts` | |
| 5 | `packages/protocol/src/handoff-line.ts` | `packages/protocol/src/handoff.ts` | |
| 6 | `apps/web/src/components/ui/dialog-stepper.tsx` (59) | `apps/web/src/components/ui/dialog.tsx` (188) | Each importer of both imports from one module. |
| 7 | `packages/devtools/src/lead/watch-format.ts` (244) | `packages/devtools/src/lead/watch.ts` (85) | |

### Steps
For each row:
1. Move the siblings' code into the base file in a sensible order (types first, then helpers, then the exports that use them). Keep every "why" comment, and drop duplicate imports.
2. Delete the siblings.
3. Point every importer at the base file. Where a file imported from both, merge them into one import.
4. **Cycles.** Check that no import cycle appears (one sibling importing a module that imports the base). If one would, skip that row and say why.

### Rules
- No behaviour change: the same exports under the same names, the same values and the same order of side effects.
- The packages' public surface (`@zilar/chat-core`, `@zilar/api-contract`, `@zilar/protocol`) keeps every exported name.
- **Tests.** Change only the import path; no new tests.

### Allowed files
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/ui/dialog-stepper.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `packages/api-contract/src/ais.ts`
- `packages/api-contract/src/connections.ts`
- `packages/api-contract/src/index.ts`
- `packages/api-contract/src/lenient-nullable-string.ts`
- `packages/api-contract/src/lenient.ts`
- `packages/api-contract/src/media.ts`
- `packages/chat-core/scripts/gen-emoji.mjs`
- `packages/chat-core/src/ai-activity.ts`
- `packages/chat-core/src/ai-computer.ts`
- `packages/chat-core/src/ai-errors.ts`
- `packages/chat-core/src/ai-form.ts`
- `packages/chat-core/src/ai-health.test.ts`
- `packages/chat-core/src/ai-health.ts`
- `packages/chat-core/src/ai-limits.test.ts`
- `packages/chat-core/src/ai-limits.ts`
- `packages/chat-core/src/ai-models.ts`
- `packages/chat-core/src/ai-providers.ts`
- `packages/chat-core/src/ai-suggestions.ts`
- `packages/chat-core/src/ai-templates.ts`
- `packages/chat-core/src/ai.ts`
- `packages/chat-core/src/avatar-identity.test.ts`
- `packages/chat-core/src/avatar-identity.ts`
- `packages/chat-core/src/avatar-seed.test.ts`
- `packages/chat-core/src/avatar-seed.ts`
- `packages/chat-core/src/avatar.ts`
- `packages/chat-core/src/connection-check.ts`
- `packages/chat-core/src/emoji-table.generated.ts`
- `packages/chat-core/src/emoji-table.ts`
- `packages/chat-core/src/emoji.ts`
- `packages/chat-core/src/index.ts`
- `packages/chat-core/src/new-ai.ts`
- `packages/devtools/src/lead/watch-format.ts`
- `packages/devtools/src/lead/watch.ts`
- `packages/protocol/src/handoff-line.ts`
- `packages/protocol/src/handoff.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/payload.ts`
- `apps/web/src/components/ui/dialog.fixture.tsx`
- `packages/devtools/src/lead/watch-app/chrome.tsx`
- `packages/devtools/src/lead/watch-app/lines.tsx`
- `packages/devtools/src/lead/watch-app/live.tsx`
- `packages/devtools/src/lead/watch-app/segments.tsx`
- `packages/devtools/src/lead/watch-app/view.tsx`
- `work/T-2154-merge-sibling-splits.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the chat-core, api-contract, protocol, web and devtools typechecks and tests.
- Product lines go down (`git diff main --numstat -- apps packages`, new files included); give the net in the Report.
- The Report lists each row: merged (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged all seven rows.

- **Row 1 — merged.** `ai-activity.ts`, `ai-computer.ts`, `ai-errors.ts`, `ai-form.ts`, `ai-health.ts`, `ai-limits.ts`, `ai-models.ts`, `ai-providers.ts`, `ai-suggestions.ts`, `ai-templates.ts` (505 lines) → `packages/chat-core/src/ai.ts` (513 lines). All 10 sibling files deleted; the 10 `index.ts` re-export lines removed; the `./ai-form` type imports in `ai-limits`/`ai-templates` removed. One private helper was renamed `formatUsd` → `formatModelUsd` inside `ai-models`' code because the merged file also has the exported `formatUsd` from `ai-health`; the private one had different formatting, so it keeps its own body and behavior. Test import paths updated in `ai-health.test.ts` and `ai-limits.test.ts`, plus `connection-check.ts` and `new-ai.ts`.
- **Row 2 — merged.** `avatar-seed.ts` (13) and `avatar-identity.ts` (40) → `avatar.ts` (113). Both `index.ts` lines removed; test imports updated.
- **Row 3 — merged.** `emoji-table.ts` (31) → `emoji.ts` (50). `index.ts` line removed; `emoji-table.generated.ts` and `scripts/gen-emoji.mjs` now import `EmojiCategoryId` from `./emoji`.
- **Row 4 — merged.** `lenient-nullable-string.ts` (20) → `lenient.ts` (59); `ais.ts`, `connections.ts`, `media.ts` and `index.ts` updated.
- **Row 5 — merged.** `handoff-line.ts` (13) → `handoff.ts` (29); `payload.ts` and `index.ts` updated.
- **Row 6 — merged.** `dialog-stepper.tsx` (59) → `dialog.tsx` (245); `DialogStepper`, `DialogStep` and `DialogStepperProps` are exported from the base file. `NewAiDialog.tsx`, `NewGroupDialog.tsx`, `ConnectionsPage.tsx` and `dialog.fixture.tsx` now import both `Dialog` and `DialogStepper` from one module, and `dialog-stepper.tsx` is deleted.
- **Row 7 — merged.** `watch-format.ts` (244) → `watch.ts` (327). The five `watch-app/*.tsx` files import from `../watch.js`; the `const { iconsEnabled } = await import('./watch-format.js')` line in `runWatch` is gone and it calls the local `iconsEnabled` directly. `watch-format.ts` is deleted.

Net product lines (`git diff main --numstat -- apps packages`): **949 added, 969 deleted, net −20**. No file exceeds 650 lines.

### Checks run

- `pnpm install` — done, 1155 packages.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/ai-health.test.ts src/ai-limits.test.ts src/avatar-seed.test.ts src/avatar-identity.test.ts` — 4 files passed, 22 tests passed.
- `pnpm gate` (from repo root, after rows 6-7):
  ```
  gate: 49 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core
  PASS  tests @zilar/devtools
  PASS  tests @zilar/protocol
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  WARN  size: apps/web/src/components/ais/NewAiDialog.tsx: 526 lines (main 527); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  WARN  size: apps/web/src/routes/ConnectionsPage.tsx: 425 lines (main 426); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  WARN  size: packages/chat-core/src/ai.ts: 513 lines (main 2); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  GATE PASS
  ```

### Notes for the lead

- No open questions. Rows 6 and 7 were finished after the Allowed files were extended.
- Row 7 behavior note: `watch-format` only had constant and function declarations, so loading it together with `watch.ts` instead of on first `runWatch` has no observable side effect.
- `components/ais/NewAiDialog.tsx` and `routes/ConnectionsPage.tsx` stay over the 400-line soft limit; this task removes a line from each and does not add any.



## Review (written by Claude)

Approved; the pre-review was clean. It checked the merges byte for byte for the stepper, handoff, lenient, emoji and watch-format rows, and body for body for AI and avatar.

All seven rows merged, 17 files fewer, net −20:
- chat-core's ten `ai-*` files into `ai.ts` (513 lines, soft limit only);
- the avatar and emoji pieces;
- api-contract lenient;
- protocol handoff line;
- the web dialog stepper into `dialog.tsx`;
- devtools watch format into `watch.ts`.

The lead added the dialog fixture and the five watch-app importers to the Allowed files mid-task.

**Checks:**
- No comment was lost.
- The web mock New AI walk (provider, key, model, setup, create) passes, with no page errors.
