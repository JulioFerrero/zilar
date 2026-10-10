---
id: T-1022
title: "Size split T100: apps/mobile/src/components/chat/topic-sheets.tsx (442 lines) into chat/{topic-actions-sheet,topic-info-sheet}; one RetryRow"
status: merged
milestone: M5
branch: task/T-1022-split-mobile-topic-sheets
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1022: Split the mobile topic sheets

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/topic-sheets.tsx` is 442 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #96 (task T100): `components/chat/topic-actions-sheet.tsx` and `chat/topic-info-sheet.tsx`, under `apps/mobile/src/`. `topic-sheets.tsx` re-exports every name it exports today.

- **In scope:** the in-file Dedup. The two error-plus-Retry blocks (roles and group roles) become one `RetryRow`, and each keeps its own text and retry call.

The lead runs a phone smoke of a Dev team topic's actions and info sheets in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #96, and `apps/mobile/src/components/chat/topic-sheets.tsx`.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.tsx`, `apps/mobile/src/components/chat/topic-info-sheet.tsx`, `work/T-1022-split-mobile-topic-sheets.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**What I did.** Move-only split of `apps/mobile/src/components/chat/topic-sheets.tsx` (442 lines) into the two files the plan entry (`docs/audit/size-plan.md` §2.2 #96) names, following `docs/audit/split-rules.md`. `topic-sheets.tsx` stays a thin barrel that re-exports every name it exported before. The plan's in-file **Dedup** is applied: the two error+Retry blocks (roles, lines 277–290, and group roles, lines 319–333) are now one module-private `RetryRow` inside `topic-info-sheet.tsx`; each call keeps its own message, accessibility label and retry handler.

**Files changed** (all inside the Allowed files):

| File | Lines | Contents |
| --- | --- | --- |
| `apps/mobile/src/components/chat/topic-sheets.tsx` | 442 → **3** | barrel: re-exports only |
| `apps/mobile/src/components/chat/topic-actions-sheet.tsx` (new) | **113** | `TopicSheetAction`, `TopicPrefAction`, `TopicActionsSheet` |
| `apps/mobile/src/components/chat/topic-info-sheet.tsx` (new) | **349** | private `RetryRow`, `TopicInfoSheet` |
| `work/T-1022-split-mobile-topic-sheets.md` | — | status + this Report |

Every file is ≤ 400 lines and no `max-lines` warning appears (lint passed).

**Move verification.** `git show HEAD:apps/mobile/src/components/chat/topic-sheets.tsx | sed -n '18,121p'` diffed against the actions-file body → **identical**. `sed -n '123,442p'` diffed against the info-file body (from its doc comment) → the **only** differences are the two Dedup blocks replaced by `<RetryRow … />`; everything else is byte-identical. The `RetryRow` render preserves the original wrapper `View className="gap-2 py-1"`, the alert `Text`, and the `Button variant="outline" … className="self-start"` with `<Text>Retry</Text>`, so behaviour is unchanged.

**Sizes (`wc -l`).** old `topic-sheets.tsx` **442**; new `topic-sheets.tsx` **3**, `topic-actions-sheet.tsx` **113**, `topic-info-sheet.tsx` **349**.

**Export list, before and after** (`grep -E "^export"`; old = `git show HEAD: …/topic-sheets.tsx`):

```
before (old topic-sheets.tsx)                after (definitions + barrel)
export type TopicSheetAction = 'archive'  →  topic-actions-sheet.tsx: export type TopicSheetAction = 'archive';
export type TopicPrefAction =             →  topic-actions-sheet.tsx: export type TopicPrefAction =
export function TopicActionsSheet({       →  topic-actions-sheet.tsx: export function TopicActionsSheet({
export function TopicInfoSheet({          →  topic-info-sheet.tsx:    export function TopicInfoSheet({
                                             topic-sheets.tsx:        export { TopicActionsSheet } from './topic-actions-sheet';
                                             topic-sheets.tsx:        export { TopicInfoSheet } from './topic-info-sheet';
                                             topic-sheets.tsx:        export type { TopicPrefAction, TopicSheetAction } from './topic-actions-sheet';
```

Same four names and kinds (two types, two functions). `RetryRow` is new and module-private, so the public surface is unchanged. Importers are untouched: only `apps/mobile/src/app/group/[id].tsx` (`TopicActionsSheet`, `TopicPrefAction`, `TopicSheetAction`) and `apps/mobile/src/components/chat/topic-info-host.tsx` (`TopicInfoSheet`) import this module, both through the barrel. No cycle forced an importer change.

**Effect ratchet.** Both new files classify `plain` (no needs-effect signal), so no `// effect-plain` marker was added. The gate's `effect` step passed.

**Commands and real results.**

- `pnpm install`: done in 17.1s (only the pre-existing `@types/react-dom` peer warning).
- `pnpm --filter @zilar/mobile typecheck` (`tsc --noEmit`): passed, no output.
- `pnpm gate` from the repo root:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: `apps/mobile/src/components/chat/` contains no `*.test.*` files (so the gate's nearest-test search found none), and split-rules rule 5 says to write no new tests.

**Deviations / notes.** The task's Checks list `pnpm --filter @zilar/mobile typecheck` separately from `pnpm gate`; both were run and passed (I kept the standalone one because the two new files are untracked on the branch and turbo's `--affected` detection can miss them).

**Open questions / blocked.** None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `topic-sheets.tsx` (442 lines) is now a 3-line barrel, plus `topic-actions-sheet` (113) and `topic-info-sheet` (349). One `RetryRow` serves both error blocks.
- **The lead's phone smoke** (mock, Dev team):
  - tapping the General topic's title opens the info sheet: "Dev team · Public", "All 5 members of the group", "AIs in this topic (0)" and the roles note;
  - a long-press on a topic in the group screen opens Pin, Mute, Archive and "Archive topic for everyone".
- **Not checked:** the RetryRow itself, because it only shows on a load error.
- **Check:** the gate passed.
