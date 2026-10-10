---
id: T-1039
title: "Size split T114: apps/mobile/src/components/chat/message-list.tsx (418 lines) into chat/{use-stable-handlers,use-message-list-scroll,message-list-row}"
status: merged
milestone: M5
branch: task/T-1039-split-mobile-message-list
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1039: Split the mobile `message-list.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-list.tsx` is 418 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #110 (task T114): `components/chat/use-stable-handlers.ts`, `chat/use-message-list-scroll.ts` and `chat/message-list-row.tsx`, under `apps/mobile/src/`. `message-list.tsx` keeps the list and every export it has today.

Move the code unchanged, and skip the Dedup, because it crosses files to `lib/effect/timers.ts`. The scroll behaviour stays the same: it keeps the bottom pinned on new messages, loads older messages near the top, and jumps to a message.

The lead runs a phone smoke of scrolling a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #110, and `apps/mobile/src/components/chat/message-list.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-stable-handlers.ts`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/message-list-row.tsx`, `work/T-1039-split-mobile-message-list.md`.

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

Split `apps/mobile/src/components/chat/message-list.tsx` (418 lines) into the
three files named by `docs/audit/size-plan.md` §2 #110, moving the code
unchanged:

- `chat/use-stable-handlers.ts` — old lines 76–113: `runLater`, the
  `MessageHandler`/`ReactHandler` types and `useStableHandler`/`useStableReact`.
  `runLater` is now exported so the two other moved files can reach it.
- `chat/use-message-list-scroll.ts` — old lines 236–311: the `listRef`,
  `previousCount`/`atBottomRef` refs and the four scroll effects (mount,
  new-message pin, search jump, pin jump), wrapped as one `useMessageListScroll`
  hook. The third-party `startJumpScroll` helper is unchanged.
- `chat/message-list-row.tsx` — old lines 370–415: the `renderItem` body, as a
  `MessageListRow` component. `ListEntry` moved here (it was a module-local type
  in the old file and is now imported by both the barrel and the scroll hook, so
  it lives in the one file that has no back-import and keeps the graph acyclic).
- `message-list.tsx` — the barrel keeps `MessageList` and every export it had
  before. It now calls `useMessageListScroll`, renders `MessageListRow`, and
  keeps the `ListEntry` build, the `view` states and the `FlatList`.

The Dedup was **skipped** as the spec says: `runLater`'s fold into
`lib/effect/timers.ts` crosses files and would edit a file outside the Allowed
files. The scroll behaviour is unchanged: bottom pinned on new messages, older
messages loaded near the top, and search/pin jumps.

### Files changed

- `apps/mobile/src/components/chat/message-list.tsx` (edited, barrel)
- `apps/mobile/src/components/chat/use-stable-handlers.ts` (new)
- `apps/mobile/src/components/chat/use-message-list-scroll.ts` (new)
- `apps/mobile/src/components/chat/message-list-row.tsx` (new)
- `work/T-1039-split-mobile-message-list.md` (this file)

No other file was touched. No importer changed: the only importer of
`message-list.tsx` (`app/chat/[id].tsx`) still imports `{ MessageList }` from the
same path.

### `wc -l` (split-rules item 8)

```
old  message-list.tsx             418
new  message-list.tsx (barrel)    280
new  use-stable-handlers.ts        42
new  use-message-list-scroll.ts   115
new  message-list-row.tsx         115
```

Every new file and the barrel are under 400 lines.

### Export list before / after (split-rules item 8)

Before (`git show HEAD:.../message-list.tsx | grep -nE "^export"`):

```
119:export function MessageList({
```

After (`grep -nE "^export"` on the barrel plus the three new files):

```
message-list.tsx:66:export function MessageList({
use-stable-handlers.ts:8:export const runLater = (ms: number, run: () => void): Fiber.Fiber<void> =>
use-stable-handlers.ts:11:export type MessageHandler = (message: UiMessage) => void;
use-stable-handlers.ts:17:export function useStableHandler(handler: MessageHandler | undefined): MessageHandler | undefined {
use-stable-handlers.ts:29:export type ReactHandler = (message: UiMessage, emoji: string) => void;
use-stable-handlers.ts:31:export function useStableReact(handler: ReactHandler | undefined): ReactHandler | undefined;
use-message-list-scroll.ts:27:export function useMessageListScroll({
message-list-row.tsx:9:export type ListEntry =
message-list-row.tsx:52:export function MessageListRow({
```

Diff: the old file's only export, `MessageList` (value, function), keeps its
name, kind and path in the barrel. The three new files add only new internal
APIs that no module imported before (`runLater`, the two handler hooks and their
types, `useMessageListScroll`, `ListEntry`, `MessageListRow`). No old export was
dropped or renamed.

### Effect ratchet (split-rules item 6)

No `// effect-plain:` marker was added. `use-stable-handlers.ts` and
`use-message-list-scroll.ts` import `effect` as a value, so the map classifies
them `effect`. `message-list-row.tsx` and the barrel carry no Effect signal and
classify `plain` (the barrel went from `effect` on main, where it imported
`Effect` for `runLater`/the interrupts, to `plain`; the ratchet only fails new or
regressed `needs-effect` files). Gate printed `PASS effect`.

### Commands run (real results)

- `pnpm install` — `Done in 12.8s using pnpm v10.32.1`; only the pre-existing
  "5.0.3 is available" notices.
- `pnpm gate` — `GATE PASS`:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The gate's `typecheck` step is the same `pnpm --filter @zilar/mobile typecheck`
the task's Checks list; it passed. The gate's `scope` line lists every changed
file as inside the Allowed files.

- Single test files run: **none**. `apps/mobile` has no test near the changed
  files (the gate's nearest-test step skipped the package) and the change is UI
  code, which per AGENTS.md gets no tests.

### Problems / deviations / open questions

- Deviation: `ListEntry` was moved from `message-list.tsx` into
  `message-list-row.tsx` (and exported) instead of staying in the barrel, so the
  scroll hook and the row can share it without a type-import cycle back into the
  barrel. Behaviour and the public surface are unchanged.
- `runLater` is exported from `use-stable-handlers.ts` (it was module-local) so
  the row and the scroll hook can use it, since the Dedup into
  `lib/effect/timers.ts` was skipped.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `message-list.tsx` (418 lines) is now 280 lines, plus `use-stable-handlers` (42), `use-message-list-scroll` (115) and `message-list-row` (115).
- **The lead's line check:** the row now takes plain `onX` props, and the list passes `stableX` into them (`message-list.tsx:252-274`). The handlers that reach each bubble are the same stable ones as before.
- **The lead's phone smoke** (mock, Ana's chat): two swipes up load the older history (October 7, then Yesterday).
- **Check:** the gate passed.
