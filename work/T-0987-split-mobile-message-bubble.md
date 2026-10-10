---
id: T-0987
title: "Size split T37: apps/mobile/src/components/chat/message-bubble.tsx (758 lines) into chat/{message-bubble-decor,message-bubble-content,message-bubble-actions,message-bubble-tombstone}; one BubbleInlineMeta"
status: merged
milestone: M5
branch: task/T-0987-split-mobile-message-bubble
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0987: Split the mobile message bubble

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-bubble.tsx` is 758 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #33 (task T37): `components/chat/message-bubble-decor.tsx`, `chat/message-bubble-content.tsx`, `chat/message-bubble-actions.tsx`, `chat/message-bubble-tombstone.tsx`, under `apps/mobile/src/`. `message-bubble.tsx` keeps the bubble and every export it has today.

The in-file Dedup is in scope: the markdown-branch meta and the plain-branch meta become one `BubbleInlineMeta`, with the same layout.

The lead runs a phone smoke of a chat in a mock build: text, markdown, an AI bubble and the long-press sheet.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #33, and `apps/mobile/src/components/chat/message-bubble.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-bubble-tombstone.tsx`, `work/T-0987-split-mobile-message-bubble.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**Status:** review. One commit on `task/T-0987-split-mobile-message-bubble`.

### What I did

Split `apps/mobile/src/components/chat/message-bubble.tsx` (758 lines) into four
new files under `apps/mobile/src/components/chat/`, following
`docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.2 #33:

- `message-bubble-decor.tsx` — constants (`TAIL_WIDTH`, `TAIL_HEIGHT`,
  `LONG_PRESS_MS`, `GENERATING_FOREGROUND`, `SWAP_MS`), `appActiveSource`,
  `BubbleTail`, `BubbleMeta`, `DraftCaret`, `GeneratingLabel`, `BigEmoji`.
- `message-bubble-content.tsx` — the per-kind body: `MessageBubbleContent`
  (attachment / card / image / voice / markdown / plain), the deduped
  `BubbleInlineMeta`, and the two bubbleless kinds `StickerBubble` and
  `BigEmojiBubble`.
- `message-bubble-actions.tsx` — `openMessageMenu` (the long-press haptic) and
  `BubbleActionsSheet` (the `MessageActionsSheet` wiring, including the
  clipboard copy).
- `message-bubble-tombstone.tsx` — `MessageTombstone`.

`message-bubble.tsx` stays the bubble: `MessageBubbleProps`, `MessageBubbleImpl`
and `export const MessageBubble = memo(MessageBubbleImpl)` unchanged, now 381
lines. It imports the moved pieces.

**Dedup (in scope).** The markdown-branch meta (old 573–604) and the
plain-branch meta (old 607–645) are now one `BubbleInlineMeta` in
`message-bubble-content.tsx`, with the same layout (the `{'  '}` gap, the
`edited` prefix, `formatTime`, the nbsp+word-joiner and the translated ticks).

### `wc -l`

```
old  apps/mobile/src/components/chat/message-bubble.tsx        758
     apps/mobile/src/components/chat/message-bubble.tsx        381
     apps/mobile/src/components/chat/message-bubble-decor.tsx  158
     apps/mobile/src/components/chat/message-bubble-content.tsx 296
     apps/mobile/src/components/chat/message-bubble-actions.tsx 127
     apps/mobile/src/components/chat/message-bubble-tombstone.tsx 49
```

Every new file and the retained barrel are ≤ 400 lines.

### Export list (before → after)

Before — `git show main:apps/mobile/src/components/chat/message-bubble.tsx | grep -nE "^export"`:

```
758:export const MessageBubble = memo(MessageBubbleImpl);
```

After — `grep -nE "^export"` on the barrel plus the four new files:

```
message-bubble.tsx:381:export const MessageBubble = memo(MessageBubbleImpl);
message-bubble-decor.tsx:13:export const TAIL_WIDTH = 9;
message-bubble-decor.tsx:14:export const TAIL_HEIGHT = 12;
message-bubble-decor.tsx:15:export const LONG_PRESS_MS = 350;
message-bubble-decor.tsx:18:export const GENERATING_FOREGROUND = '#8f8f8f';
message-bubble-decor.tsx:21:export const SWAP_MS = 400;
message-bubble-decor.tsx:25:export const appActiveSource: ActiveSource = {
message-bubble-decor.tsx:36:export function BubbleTail({ outgoing, color }: { outgoing: boolean; color: string }) {
message-bubble-decor.tsx:56:export function BubbleMeta({
message-bubble-decor.tsx:83:export function DraftCaret({ reduceMotion }: { reduceMotion: boolean }) {
message-bubble-decor.tsx:107:export function GeneratingLabel() {
message-bubble-decor.tsx:118:export function BigEmoji({
message-bubble-content.tsx:50:export function BubbleInlineMeta({
message-bubble-content.tsx:93:export function MessageBubbleContent({
message-bubble-content.tsx:221:export function StickerBubble({
message-bubble-content.tsx:268:export function BigEmojiBubble({
message-bubble-actions.tsx:37:export function openMessageMenu(setMenuOpen: (open: boolean) => void): void {
message-bubble-actions.tsx:46:export function BubbleActionsSheet({
message-bubble-tombstone.tsx:8:export function MessageTombstone({
```

The one old export keeps its name and kind: `MessageBubble` (const) stays in
the barrel. The new files export only new internal APIs; no module imported
them before. The only importer of the old path,
`apps/mobile/src/components/chat/message-list.tsx:15`, still imports
`MessageBubble` and is unchanged.

### Effect ratchet (`// effect-plain:` markers)

No marker was added. `message-bubble-actions.tsx` imports `effect` as a value
(it holds the clipboard and haptic `Effect.runFork`s), so the map classifies it
`effect`. `message-bubble-decor.tsx`, `message-bubble-content.tsx`,
`message-bubble-tombstone.tsx` and the barrel carry no Effect signal, so they
classify `plain`. The barrel goes from `effect` on main (it imported `Effect`
for the same two calls) to `plain`; the ratchet only fails new or regressed
`needs-effect` files, and the gate's `PASS effect` confirms it.

### Commands run (real results)

- `pnpm install` — done in 21.6s; only the pre-existing deprecated
  `uuid@7.0.3` and the pre-existing `@types/react-dom` peer warning.
- `pnpm exec prettier --write` on the five changed files (targeted, to avoid a
  red format step on hand-split JSX): the first run reformatted the barrel and
  the content file; the second run reported all five unchanged.
- `pnpm gate` — `GATE PASS`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.7s)
PASS  lint  (1.3s)
PASS  typecheck  (4.6s)
PASS  effect  (0.9s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: **none**. `apps/mobile` has no tests near the changed
  files and the gate's nearest-test step skipped the package ("no nearby test
  files"). Per AGENTS.md, UI code gets no tests.
- The task's `pnpm --filter @zilar/mobile typecheck` is covered by the gate's
  `PASS typecheck` (it typechecks every touched package); I did not run it
  separately, per AGENTS.md's "run the checks through `pnpm gate` once" rule.

### Deviations from the spec (split rules)

- **Rule 4 — the retained `message-bubble.tsx` was 410 lines.** With only the
  plan's named ranges (decor 41–186, content 501–647, actions 359–366 + 688–748,
  tombstone 374–404), the barrel came to 410 lines, over the 400 limit. As the
  accepted web split (T-0971) did, I moved two more cohesive pieces, unchanged,
  into the *named* content file: the sticker arm (`StickerBubble`) and the
  big-emoji arm (`BigEmojiBubble`). `message-bubble.tsx` is now 381 lines. Both
  live inside `message-bubble-content.tsx`, which is in the Allowed files; no
  file outside the Allowed set was touched.
- The plan's `message-bubble-content.tsx` range said "per-kind body, 501–647";
  it now also holds those two bubbleless kinds (221–296). The dedup and the
  plan's other boundaries are as written.

### Behaviour

No behaviour change. The markdown and plain branches render the same inline
meta through `BubbleInlineMeta` (same classes, same nbsp+word-joiner, same
translated ticks). The extracted components render at the same JSX positions
with the same props; the sticker and big-emoji kinds keep their sender header,
forward header, reply quote and Retry. Rendered structure and text are
unchanged, so the lead's phone smoke (text, markdown, an AI bubble, long-press
sheet) is the real check.

### Security checklist

Internal mobile UI refactor: no secrets, no scoped deletes/updates, no routes,
no caps, no audit entries. Nothing on the checklist applies. No dependency was
added; no check, test or lint rule was disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `message-bubble.tsx` (758 lines) is now 381 lines, plus `message-bubble-{decor,content,actions,tombstone}`, the largest `content` at 296. One `BubbleInlineMeta` serves both branches.
- **The lead's phone smoke** (mock build, Dev team › General):
  - text, the @You mention, Dev-1's markdown (heading, bold, code, list) and my own bubble with its check all render;
  - a long-press opens the sheet with the 6 reactions and Reply, Forward, Select, Edit, Copy text, Delete for everyone and Pin;
  - 👍 adds "👍 1".
- **Seen on main too:** "Could not load pins" in mock mode (wave 2), and an empty Dev-1 bubble (06:48).
- **Check:** the gate passed.
