---
id: T-0971
title: "Size split T25: apps/web/src/components/MessageBubble.tsx (846 lines) into components/message/{SendFailure,MessageMeta,BigEmoji,AttachmentBody,MessageTextBody,MessageMenu}.tsx; one MessageMenu for both bubbles"
status: merged
milestone: M5
branch: task/T-0971-split-web-message-bubble
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0971: Split `MessageBubble.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/MessageBubble.tsx` is 846 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #21 (task T25): `components/message/SendFailure.tsx`, `message/MessageMeta.tsx`, `message/BigEmoji.tsx`, `message/AttachmentBody.tsx`, `message/MessageTextBody.tsx`, `message/MessageMenu.tsx`, under `apps/web/src/`. `MessageBubble.tsx` keeps the `MessageBubble` component and every export it has today.

- **In scope:** the in-file Dedup. The `MessageActionsMenu` block (sticker bubble 450–494, normal bubble 775–826) and the `ConfirmDialog` (495–506, 828–839) are verbatim copies, so they become one `MessageMenu` used by both bubbles. Its props must cover both uses exactly.
- **Out of scope:** any visual change.

The lead checks in Chrome in mock mode: a text bubble, a sticker bubble, the actions menu on each (react, reply, edit, delete with confirm), a failed send, and the AI markdown.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #21, and `apps/web/src/components/MessageBubble.tsx`.

### Allowed files
`apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/message/SendFailure.tsx`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/message/BigEmoji.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/message/MessageTextBody.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `work/T-0971-split-web-message-bubble.md`.

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

Split `apps/web/src/components/MessageBubble.tsx` (846 → 383 lines) into the
six files the plan entry names, moving the code unchanged (only Prettier
re-indented it) and applying the entry's dedup. `MessageBubble.tsx` keeps the
`MessageBubble` component and re-exports `SendFailure`; every export is
preserved. No importer changed: `MessageList.tsx` still imports
`{ MessageBubble }` from `./MessageBubble`.

- `message/SendFailure.tsx` — the "Not sent" row (75–110).
- `message/MessageMeta.tsx` — `SENDER_COLORS`, `senderColor`, `MessageMeta`
  (46–67, 112–136), plus `MessageSender`, the shared sender-name header (the
  two copies at 400–408 and 527–535).
- `message/BigEmoji.tsx` — `BigEmoji`, `DraftCaret`, `GeneratingLabel`
  (138–192).
- `message/AttachmentBody.tsx` — the image / attachment / GIF / voice / card
  blocks (553–693) plus the attachment-only meta row (744–753).
- `message/MessageTextBody.tsx` — the markdown and plain-text blocks and the
  `generating` label (695–742).
- `message/MessageMenu.tsx` — the one `MessageMenu`: the duplicated
  `MessageActionsMenu` + `ConfirmDialog` (sticker 450–506, normal 775–839) with
  its `menuOpen`/`confirmOpen` state and the delete/pin/unpin/copy/edit store
  calls, plus `MessageActionsButton`, the shared "Message actions" trigger
  (435–448, 757–771).

### `wc -l`

```
old: apps/web/src/components/MessageBubble.tsx (main)        846
apps/web/src/components/MessageBubble.tsx                    383
apps/web/src/components/message/SendFailure.tsx               45
apps/web/src/components/message/MessageMeta.tsx               54
apps/web/src/components/message/BigEmoji.tsx                  59
apps/web/src/components/message/AttachmentBody.tsx           193
apps/web/src/components/message/MessageTextBody.tsx           78
apps/web/src/components/message/MessageMenu.tsx              153
```

Every new file and the retained `MessageBubble.tsx` are ≤ 400 lines.

### Export list (before → after)

Before (`git show main:apps/web/src/components/MessageBubble.tsx | grep -nE "^export"`):

```
75:export function SendFailure({
194:export interface MessageBubbleProps {
223:export const MessageBubble = memo(function MessageBubble({
```

After (`grep -nE "^export"` on the barrel plus the new files):

```
MessageBubble.tsx:26:   export { SendFailure } from './message/SendFailure';
MessageBubble.tsx:31:   export interface MessageBubbleProps {
MessageBubble.tsx:60:   export const MessageBubble = memo(function MessageBubble({
message/SendFailure.tsx:10:   export function SendFailure({
message/MessageMeta.tsx:18:   export function MessageMeta({
message/MessageMeta.tsx:44:   export function MessageSender({ message, className } ...
message/BigEmoji.tsx:5:   export function BigEmoji({
message/BigEmoji.tsx:43:  export function DraftCaret() {
message/BigEmoji.tsx:52:  export function GeneratingLabel() {
message/AttachmentBody.tsx:13: export function AttachmentBody({
message/MessageTextBody.tsx:14: export function MessageTextBody({
message/MessageMenu.tsx:21:  export function MessageActionsButton({
message/MessageMenu.tsx:47:  export function MessageMenu({
```

The three old exports keep the same names and kinds: `SendFailure` (function
value) and `MessageBubbleProps` (interface) are re-exported/re-kept by the
barrel, `MessageBubble` (const) stays in the barrel. `senderColor` stays
module-private as it was on main. The new files export only their own new APIs;
no module imported them before and none does now.

### Commands run (real results)

- `pnpm install` — done; only the pre-existing deprecated `uuid@7.0.3` and a
  `@types/react-dom` peer warning.
- `pnpm --filter @zilar/web build` — success: `✓ built in 840ms`; only the
  pre-existing ">500 kB chunk" warning. `MarkdownText-*.js` is still emitted as
  its own chunk, so the lazy import still code-splits.
- Targeted Effect ratchet on the changed files
  (`ratchet-cli.ts --base main <files>`) — `effect: ok (7 files checked)` after
  the marker below.
- `pnpm gate` — `GATE PASS`:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.5s)
PASS  lint  (0.8s)
PASS  typecheck  (3.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: **none**. `apps/web` has no tests near the changed
  files and the gate's nearest-test step skipped the package
  ("no nearby test files"). Per AGENTS.md, UI code gets no tests.
- Before `pnpm gate` I ran `pnpm exec prettier --write` once on the seven
  changed files (targeted, not the whole repo) so the gate's format step would
  not fail on re-indented JSX.

### Deviations from the spec (split rules)

1. **Rule 4 — the retained `MessageBubble.tsx` was over 400.** With only the
   plan's named ranges, `MessageBubble.tsx` came to 433 lines (the plan's own
   ranges are a reading aid; the entry does not name a further file). Rule 4
   requires the file to stay ≤ 400, so I moved three more cohesive pieces into
   the *named* files, each unchanged and inside the Allowed set:
   - `MessageSender` (the sender-name header, duplicated in both bubbles) →
     `MessageMeta.tsx`, next to `senderColor` which it uses;
   - the attachment-only meta row (744–753) → `AttachmentBody.tsx` (it only
     renders when there is no text, so `MessageTextBody` is empty then and the
     rendered order is identical);
   - `MessageActionsButton` (the duplicated "Message actions" trigger) →
     `MessageMenu.tsx`.
   `MessageBubble.tsx` is now 383 lines.
2. **Rule 6 — Effect ratchet marker.** `MessageTextBody.tsx` is classified
   `needs-effect` only because it holds the lazy markdown loader
   (`import('../MarkdownText').then(...)`) moved unchanged from
   `MessageBubble.tsx`. I added the sanctioned marker as line 1:
   `// effect-plain: moved unchanged from apps/web/src/components/MessageBubble.tsx (size split)`.
   It is the only marker added. `MessageBubble.tsx` itself goes from `effect`
   on the base to `plain` (the old `runDetached`/Effect import moved to
   `MessageMenu.tsx`); the ratchet accepts that.

### Behaviour

No behaviour change. The two `MessageActionsMenu` + `ConfirmDialog` copies
collapse into one `MessageMenu` whose props cover both uses exactly
(`canCopy`, `canEdit`, `canDelete`, `canPin`, `canForward`, `align`, `pinId`
plus `onReply`/`onForward`/`onSelectMessages`/`onReact`); the sticker call site
still passes `canCopy={false}` / `canEdit={false}`, so its Edit/Copy items stay
unreachable, and `onReact` still closes before reacting. `MessageActionsButton`
and `MessageSender` render at the same JSX positions with the same classes, so
absolute positioning and DOM order are unchanged. The attachment meta row and
`MessageTextBody` ordering is unchanged because the latter renders nothing when
`hasText` is false.

### Security checklist

Internal web UI refactor: no secrets, no scoped deletes/updates, no routes, no
caps, no audit entries. Nothing on the checklist applies. No dependency was
added; no check, test or lint rule was disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `MessageBubble.tsx` (846 lines) is now 383 lines, plus six files in `components/message/`, the largest `AttachmentBody.tsx` at 193. One `MessageMenu` serves both bubbles.
- **The lead checked it in Chrome at `?mock=1`:**
  - Dev-1's markdown renders;
  - my message's "…" menu shows the reactions and Reply, Forward, Select, Edit, Copy text, Delete for everyone and Pin;
  - 👍 adds a reaction;
  - Delete opens the in-page confirm, and confirming shows "You deleted this message".
- **Not checked:** the sticker bubble, because the mock seed has no sticker message yet.
- **Check:** the gate passed, and so did the web build.
