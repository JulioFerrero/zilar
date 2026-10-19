---
id: T-2190
title: "Comments that name a file which no longer exists point at its current home, or drop the file name; comment lines only"
status: merged
milestone: M5
branch: task/T-2190-stale-file-refs
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2190: Comments name files that exist

## Spec (written by Claude, do not edit)

### Why
Tonight's folds and merges moved code into other files. A comment that says "as `rating-block.tsx` does" now sends a reader, person or AI, to a file that is gone.

### Facts (the lead's scan on 2026-10-19, at `a8e76b995`)
Each row is `file:line` and the file name the comment cites, which no longer exists anywhere in the repo:
1. `apps/mobile/src/components/chat/attach-sheet.tsx:98`: `gradient-swap.test.ts`
2. `apps/mobile/src/components/nav/floating-tab-bar.tsx:49`: `gradient-swap.test.ts`
3. `apps/mobile/src/components/chat/blocks/block-card.tsx:425`: `blockIcons.ts`
4. `apps/mobile/src/components/chat/blocks/choice-blocks.tsx:241`: `rating-block.tsx`
5. `apps/mobile/src/components/chat/blocks/content-blocks.tsx:54`: `place-block.tsx`
6. `apps/mobile/src/components/chat/blocks/content-blocks.tsx:210`: `link-block.tsx`
7. `apps/mobile/src/components/chat/blocks/figure-block.tsx:12`: `number-block.tsx`
8. `apps/mobile/src/components/chat/markdown-text.tsx:19`: `link-text.tsx`
9. `apps/mobile/src/components/chat/topic-info-sheet.tsx:63`: `leave-topic-sheet.tsx`
10. `apps/mobile/src/test/node-types.d.ts:2`: `apps/mobile/src/lib/native-pitfalls-scan.ts`
11. `apps/mobile/src/test/wait.ts:6`: `src/test/noRawTimeoutWaits.test.ts`
12. `apps/server/src/agents/group-turn-card.test.ts:78`: `request-action.ts`
13. `apps/server/src/hands/cloud-hands.test.ts:14`: `packages/desk/src/agent/wire.ts`
14. `apps/server/src/hands/desk-status.test.ts:92`: `packages/desk/src/agent/wire.ts`

### Steps
1. For each row, find where the cited code lives now: `git log --diff-filter=D --name-only -- '**/<name>'` shows the commit that removed it, and `git grep` finds the moved function or component.
2. If the code moved, change the file name in the comment to its current file (or to the function or component name, when that reads better).
3. If the code or test is gone for good, drop the file reference and keep the rest of the comment's "why". If nothing useful is left, delete the comment.
4. Change comment lines only: no code, no test logic.
5. Report each row: what the comment now points at, or why it was dropped.

### Allowed files
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/figure-block.tsx`
- `apps/mobile/src/components/chat/markdown-text.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/test/node-types.d.ts`
- `apps/mobile/src/test/wait.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `apps/server/src/hands/cloud-hands.test.ts`
- `apps/server/src/hands/desk-status.test.ts`
- `work/T-2190-stale-file-refs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The diff changes comment lines only.
- None of the 14 rows still names a file that does not exist.

---

## Report (written by the worker when done)

All 14 rows are fixed. The diff changes comment lines only.

### Where each reference points now

1. `attach-sheet.tsx:98` — `gradient-swap.test.ts` was deleted with the UI tests (T-0931..T-0934), so the reference was dropped; the WHY (key the face by its look so Android rebuilds it) stays.
2. `floating-tab-bar.tsx:49` — same deletion; reference dropped, the keyed-by-look WHY stays.
3. `block-card.tsx:425` — web's `blockIcons.ts` was folded into `apps/web/src/components/message/blocks/BlockCard.tsx`; now says web's `BlockCard.tsx`.
4. `choice-blocks.tsx:241` — `rating-block.tsx` was folded into this file; now names `RatingBlock`.
5. `content-blocks.tsx:54` — `place-block.tsx` was folded into this file and its `KEY` is now `DIRECTIONS_KEY` below; now names `DIRECTIONS_KEY`.
6. `content-blocks.tsx:210` — `link-block.tsx` was folded into `block-card.tsx`; now names `LinkBlock`.
7. `figure-block.tsx:12` — `number-block.tsx` was folded into `block-card.tsx`; now names `NumberBlock` in `block-card.tsx`.
8. `markdown-text.tsx:19` — `link-text.tsx` was folded into `plain-bubble-body.tsx`; now names that file.
9. `topic-info-sheet.tsx:63` — `leave-topic-sheet.tsx` was folded into `topic-info-host.tsx`; now names that file.
10. `node-types.d.ts:2` — `native-pitfalls-scan.ts` was deleted as dead code (T-2016); the node types are still needed for `apps/mobile/app.config.ts`, which uses `node:fs`, so the comment now says that.
11. `wait.ts:6` — `noRawTimeoutWaits.test.ts` was deleted with the UI tests; reference dropped, the flakiness WHY kept.
12. `group-turn-card.test.ts:78` — `request-action.ts` was folded into `gateway/tool-exec.ts`; now names `tool-exec.ts`.
13. `cloud-hands.test.ts:14` — `packages/desk/src/agent/wire.ts` was folded into `packages/desk/src/agent/server.ts`; now names that file.
14. `desk-status.test.ts:92` — the status shape now lives in `packages/desk/src/agent/lifecycle.ts` (`DeskStatus`); now names that file.

### Files changed

- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/figure-block.tsx`
- `apps/mobile/src/components/chat/markdown-text.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/test/node-types.d.ts`
- `apps/mobile/src/test/wait.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `apps/server/src/hands/cloud-hands.test.ts`
- `apps/server/src/hands/desk-status.test.ts`
- `work/T-2190-stale-file-refs.md`

### Commands run

- `pnpm install --frozen-lockfile` — Done in 12.8s using pnpm v10.32.1.
- `pnpm gate` — GATE PASS. Summary lines:

```
PASS  install (frozen)  (1.1s)
PASS  format  (1.7s)
PASS  lint  (0.8s)
PASS  typecheck  (3.9s)
PASS  effect  (0.8s)
PASS  build @zilar/server  (0.3s)
PASS  tests @zilar/mobile  (1.7s)
PASS  tests @zilar/server  (3.9s)
scope: every changed file is inside the Allowed files
comments: no task IDs in added comments
GATE PASS
```

The gate also printed size WARN lines for pre-existing files over the 400-line soft limit; none is over 800 lines and the run ends in GATE PASS.

### Problems, deviations and open questions

- No problems. No single test files were run separately: the changes are comments only, and `pnpm gate` ran the mobile and server suites.
- Deviation: rows 1, 2 and 11 cite tests that are gone for good, so those file references were dropped and the WHY kept, per the spec's step 3.

## Review (written by Claude)

Approved; the pre-review passed with 1 nit (one comment names a basename that two folders use). Comment lines only, net −2.

All 14 comments that named a deleted file now name a file or component that exists:
- `RatingBlock`, `LinkBlock`, `NumberBlock`, web `BlockCard.tsx`;
- `plain-bubble-body.tsx`, `app.config.ts`, `tool-exec.ts`, desk `agent/server.ts`.

A dead test reference was dropped and its "why" kept.

## Review (written by Claude)

Approved; the pre-review passed with 1 nit (one comment names a basename that two folders use). Comment lines only, net −2.

All 14 comments that named a deleted file now name a file or component that exists:
- `RatingBlock`, `LinkBlock`, `NumberBlock`, web `BlockCard.tsx`;
- `plain-bubble-body.tsx`, `app.config.ts`, `tool-exec.ts`, desk `agent/server.ts`.

A dead test reference was dropped and its "why" kept.
