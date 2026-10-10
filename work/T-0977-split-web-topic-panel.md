---
id: T-0977
title: "Size split T32: apps/web/src/components/TopicPanel.tsx (780 lines) into components/panels/{topicPanelOps,TopicRulesSection,TopicRolesSection}; one list loader for members and AIs"
status: merged
milestone: M5
branch: task/T-0977-split-web-topic-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0977: Split `TopicPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/TopicPanel.tsx` is 780 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #28 (task T32): `components/panels/topicPanelOps.ts`, `panels/TopicRulesSection.tsx` and `panels/TopicRolesSection.tsx`, under `apps/web/src/`. `TopicPanel.tsx` keeps the panel and every export it has today.

`topicPanelOps.ts` would be about 330 lines from the plan's range, which is fine.

The in-file Dedup is in scope:
- the members load and the AIs load become one generic `useListLoader`;
- `removeMember` and `removeAi` share one helper.

Every user-facing text stays the same.

The lead checks it in Chrome in mock mode: Dev team › General topic info, with the members, the AIs, adding and removing one, and the roles section.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #28, and `apps/web/src/components/TopicPanel.tsx`.

### Allowed files
`apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/panels/topicPanelOps.ts`, `apps/web/src/components/panels/TopicRulesSection.tsx`, `apps/web/src/components/panels/TopicRolesSection.tsx`, `work/T-0977-split-web-topic-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/TopicPanel.tsx` exactly as plan §2.2 #28 (task T32) says:

- New `components/panels/topicPanelOps.ts` holds the panel's state and actions:
  `storeCall`, the clients for the store calls, the two list loaders (now one
  generic `useListLoader`), the tools / my-AIs reads, the pickers, the confirm
  state, `refreshTopicRowOnce`, `afterMissingMember`, the add/remove/leave/
  archive/visibility effects and the three `useAction`s, exposed through one
  `useTopicPanelOps` hook.
- New `components/panels/TopicRulesSection.tsx`: the Always-allowed section
  (old lines 540-555), moved unchanged.
- New `components/panels/TopicRolesSection.tsx`: the roles + approver section
  (old lines 557-780), moved unchanged.
- `TopicPanel.tsx` keeps the panel; it now calls `useTopicPanelOps`, computes
  the derived values (old lines 375-405) and renders the same JSX.

In-file dedup, both in scope:

- The members load (old 121-158) and the AIs load (old 160-189) are now the one
  generic `useListLoader<Item, Id>({ load, fallback, deps, idOf, keepReadyOnDrop })`.
  `keepReadyOnDrop` carries the one difference between the two (`length > 1` vs
  `length > 0`), so behaviour is unchanged.
- `removeMember` and `removeAi` (old 271-308) now share `removeRow`, which takes
  the store call, the list re-read and the local drop; the members path passes
  `onMissing: afterMissingMember`, the AIs path passes none (same as before).

No behaviour change: the two moved sections diff byte-for-byte against the old
file except for the `export` keyword (see below), and every user-facing string
is identical.

### Files changed

- `apps/web/src/components/TopicPanel.tsx` (modified)
- `apps/web/src/components/panels/topicPanelOps.ts` (new)
- `apps/web/src/components/panels/TopicRulesSection.tsx` (new)
- `apps/web/src/components/panels/TopicRolesSection.tsx` (new)
- `work/T-0977-split-web-topic-panel.md` (this Report)

`git status --porcelain` shows only these files; no file outside the Allowed
files changed.

### `wc -l` (split-rules item 8)

- old `apps/web/src/components/TopicPanel.tsx`: **780** (main)
- new `apps/web/src/components/panels/topicPanelOps.ts`: **398**
- new `apps/web/src/components/panels/TopicRulesSection.tsx`: **18**
- new `apps/web/src/components/panels/TopicRolesSection.tsx`: **243**
- new `apps/web/src/components/TopicPanel.tsx` (barrel + panel): **243**

Every new file and the barrel are ≤ 400.

### Export list before / after (split-rules item 8)

Before (`git show main:apps/web/src/components/TopicPanel.tsx | grep -E "^export"`):

```
export function TopicPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
```

After (barrel + new files):

```
TopicPanel.tsx:export function TopicPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
topicPanelOps.ts:export type PanelStatus = 'loading' | 'ready' | 'error';
topicPanelOps.ts:export const storeCall = <A>(call: () => Promise<A>): Effect.Effect<A, ApiFailure> =>
topicPanelOps.ts:export function useTopicPanelOps({
TopicRulesSection.tsx:export function TopicRulesSection({
TopicRolesSection.tsx:export function TopicRolesSection({
```

`TopicPanel` (the only name the old file exported) keeps its name and kind. The
other exports are new APIs of the new files; nothing outside this task imported
`PanelStatus`, `storeCall`, `TopicRulesSection` or `TopicRolesSection` before, so
no importer changed.

Moved-section check: `diff` of old lines 540-780 against the two new section
files is empty except for adding `export` on the two function declarations.

### Commands run (real results)

- `pnpm install` — done (`Done in 22s using pnpm v10.32.1`); only the
  pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/web build` — success (`✓ built in 1.10s`); only the
  pre-existing ">500 kB chunk" warning.
- `pnpm gate` — `GATE PASS`:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.9s)
PASS  lint  (0.9s)
PASS  typecheck  (2.8s)
PASS  effect  (0.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: none. `apps/web` has no `TopicPanel` tests and the
  gate's nearest-test step skipped the package ("no nearby test files"). Per
  AGENTS.md, UI code gets no tests.

### Problems hit and fixed

- First `pnpm --filter @zilar/web build` failed with `MISSING_EXPORT`:
  `TopicRolesSection.tsx` imported `textOf`/`failInline` from `topicPanelOps`,
  but those two helpers already live in `topic-failure.ts` (extracted by an
  earlier task) and `topicPanelOps` only imports them. Fixed by importing
  `failInline`/`textOf` from `./topic-failure` and only `storeCall`/`PanelStatus`
  from `./topicPanelOps`. I did not re-export them from `topicPanelOps`.
- First `pnpm gate` failed at `format` (`topicPanelOps.ts`); I ran
  `pnpm exec prettier --write` on that one file, then
  `pnpm exec prettier --check` (all clean).
- Second `pnpm gate` failed at `typecheck`: `topicId` was still referenced by
  the JSX (`scopeKey={`topic:${topicId}`}`) but its declaration had moved into
  the hook. Re-added `const topicId = topic.id;` in the body.
- Third `pnpm gate`: `GATE PASS`.

### Deviations from the spec

- None of substance. `topicPanelOps.ts` came to 398 lines; before Prettier ran
  it was 407, so I condensed one doc comment of my own (not moved code) to stay
  under 400 (rule 4). No extra file was needed.
- `textOf`/`failInline` are not re-homed into `topicPanelOps.ts`: the plan's
  range lists them because they were in the old file, but a prior task already
  moved them to `panels/topic-failure.ts`. `TopicPanel.tsx`/`topicPanelOps.ts`
  import them from there, as before.

### Effect ratchet

No `// effect-plain:` marker was added. `topicPanelOps.ts` and
`TopicRolesSection.tsx` import `Effect` as a value (`effect`); `TopicRulesSection.tsx`
is pure UI with no signal hit (`plain`). The gate's `effect` step passed.

### Security checklist

Internal UI refactor: no secrets, no routes, no deletes/updates, no caps, no
audit entries. Nothing on the checklist applies. No dependency was added and no
check, test or lint rule was disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `TopicPanel.tsx` (780 lines) is now 243 lines, plus `panels/topicPanelOps.ts` (398), `TopicRulesSection` and `TopicRolesSection`. One list loader serves members and AIs, and one remove helper serves both.
- **The lead checked it in Chrome at `?mock=1`, on the Dev team › General topic info:**
  - the members, AIs, always-allowed, tools, routines and pinned sections show;
  - Add my AI lists Dev-1 and QA-1, and adding QA-1 shows "Added by you";
  - Remove brings back "No AIs in this topic yet".

  The roles section shows only on private topics, and General is public.
- **Follow-up to check on main:** the first click on a chat-header info button after a page load did nothing, and the second click opened the panel. This happened on this branch and on T-0973's.
- **Check:** the gate passed, and so did the web build.
