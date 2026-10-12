---
id: T-1228
title: "Delivered tick, step 1 (plan tasks 1 + 5): MessageStatus gains 'delivered' ranked between sent and read on the forward-only ladder, and both apps draw it — delivered = two grey ticks, seen = two ticks in the brighter 'seen' look — so the later steps only have to set the status"
status: merged
milestone: M5
branch: task/T-1228-delivered-status-and-ticks
model: auto
effort: default
depends_on: [T-1226]
estimate: 0.2 day
---

# T-1228: The delivered status and its ticks

## Spec (written by Claude, do not edit)

### Why
`docs/plan/delivered-tick.md` (T-1226, with Julio's decisions at the top) adds `delivered` between `sent` and `read`. This task is the plan's §9 tasks 1 and 5: the type, the ladder and the icons. Nothing sets `delivered` yet; later tasks do.

### What to build
1. **Type:** add `'delivered'` to `MessageStatus` (`packages/chat-core/src/types.ts:7`) → `'sending' | 'sent' | 'delivered' | 'read' | 'failed'`.
2. **Ladder** (`packages/client-core/src/store/rows.ts:46-62`):
   - set `STATUS_RANK` to sending 0, sent 1, delivered 2, read 3;
   - keep `failed` outside the ladder, as today: `advanceStatus` returns `current` whenever either side is `failed`. Give `failed` the top rank (3) in the record, as today it shares `read`'s rank;
   - update the comment above to `sending -> sent -> delivered -> read`.
3. **Web ticks** (`apps/web/src/components/MessageTicks.tsx:4-15`):
   - `delivered` → `CheckCheck` with `aria-label="Delivered"`, in the meta colour (today's look for `read`);
   - `read` → `CheckCheck` with `aria-label="Read"` in a brighter "seen" colour, so seen differs from delivered. Use an existing token from `apps/web/src/index.css` that reads brighter on both the outgoing bubble and the chat-list row, and cite it. Mobile already draws seen brighter: `#ededed` vs `MUTED_FOREGROUND`, at `apps/mobile/src/components/chat/chat-list-item.tsx:144-147`;
   - the call sites stay as they are (`MessageMeta.tsx:39`, `ChatListItem.tsx:166`, `TopicRow.tsx:142`, `StickerMessage.tsx:56`).
4. **Mobile ticks** (`apps/mobile/src/components/chat/ticks.tsx:13-27`):
   - `delivered` and `read` both draw `CheckCheck`; the caller's colour sets the look;
   - in the list rows (`chat-list-item.tsx:144-147`, `apps/mobile/src/components/chat/topic-row.tsx:162-165`), only `read` keeps `#ededed`, and `delivered` and `sent` use `MUTED_FOREGROUND`;
   - in the bubble meta (`apps/mobile/src/components/chat/message-bubble-content.tsx:96,162`), `read` gets a brighter colour than `delivered`, the same way. Find what `color` is at `:96` and cite it.
   - Check that the mobile `MessageStatus` (`apps/mobile/src/lib/types.ts:19`) is the chat-core type; if it's a copy, add `'delivered'` there.
5. **Every other place that switches on a status** must handle `'delivered'`. Run `tsc` on web, mobile and client-core, and grep for `=== 'read'` and `=== 'sent'` on statuses. A check like "is this message settled?" (`sent` or `read`) must also accept `delivered`; list each one you change in the Report.
6. **Tests** (the message pipeline), in `packages/client-core/src/store/ledger.test.ts`, next to the existing `advanceStatus` cases, plus up to 3:
   - delivered then sent stays delivered;
   - delivered then read is read;
   - read then delivered stays read.

### Read first
`AGENTS.md`, `docs/plan/delivered-tick.md` (the Decisions, §5 and §8), `packages/client-core/src/store/rows.ts`, `apps/web/src/components/MessageTicks.tsx`, `apps/mobile/src/components/chat/ticks.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx:80-170`, `apps/mobile/src/components/chat/chat-list-item.tsx:130-150` and `apps/mobile/src/components/chat/topic-row.tsx:150-170`.

### Allowed files
`packages/chat-core/src/types.ts`, `packages/client-core/src/store/**`, `apps/web/src/components/**`, `apps/web/src/index.css`, `apps/mobile/src/components/chat/**`, `apps/mobile/src/lib/types.ts`, `work/T-1228-delivered-status-and-ticks.md`.

Change only the status lines and their direct callers in those folders.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- No screen changes until a message is `delivered`; sent and sending look as today.

---

## Report (written by the worker when done)

### What I did
Step 1 (types + ladder + icons) of the delivered-tick plan; nothing sets
`delivered` yet — later tasks do.

- `packages/chat-core/src/types.ts:7`: `MessageStatus` gains `'delivered'` →
  `'sending' | 'sent' | 'delivered' | 'read' | 'failed'`.
- `packages/client-core/src/store/rows.ts:46-62`: `STATUS_RANK` is now
  sending 0, sent 1, delivered 2, read 3; `failed` keeps rank 3 but stays
  outside the ladder (`advanceStatus` returns `current` when either side is
  `failed`). Comment updated to `sending -> sent -> delivered -> read`.
- `apps/web/src/components/MessageTicks.tsx:11-16`: `delivered` → grey
  `CheckCheck` (`aria-label="Delivered"`, inherits the surrounding
  `text-subtle-foreground` meta colour from `ChatListItem.tsx:165` and
  `TopicRow.tsx:141`); `read` → `CheckCheck` in `text-online`
  (`--online: #22c55e`, `index.css:58,89`), an existing token brighter than
  the meta grey on both the light outgoing bubble (`bubble-out`,
  `index.css:331-340`) and the dark list row. Call sites unchanged.
- `apps/mobile/src/components/chat/ticks.tsx:21`: `delivered` draws
  `CheckCheck` like `read`; the caller's colour sets the look.
- `chat-list-item.tsx:144-147` and `topic-row.tsx:162-165`: unchanged —
  only `read` gets `#ededed`, `delivered` and `sent` already get
  `MUTED_FOREGROUND`, exactly the spec mapping.
- Bubble meta (`message-bubble-content.tsx:62-64` `BubbleInlineMeta`,
  `message-bubble-decor.tsx:67-69` `BubbleMeta`, `:157` `BigEmoji`,
  `message-bubble-content.tsx:162` image overlay): `read` gets `#22c55e`
  (matches web's `--online` and existing `Avatar.tsx` online-dot usage),
  every earlier state keeps the passed meta colour. `:96` `color` is
  `metaColor` = `BUBBLE_COLORS.outgoingMeta` (`palette.bubbleOutMeta`,
  `#525252`) for outgoing text bubbles (`message-bubble.tsx:150`).
- Mobile `MessageStatus` (`apps/mobile/src/lib/types.ts:15-23`) is a
  re-export of the chat-core type, so no copy to update.
- Item 5 sweep: `tsc` passes for web, mobile and client-core (via gate);
  greps for `=== 'read'` / `=== 'sent'` on message statuses show only the
  tick colour ternaries and `failed`/`sending` guards — no "is settled"
  (`sent` or `read`) check exists anywhere, so nothing else to widen. The
  only extra change: `incoming.ts:48-50` comment ("is delivered after all"
  → "reached it after all") so `delivered` no longer reads as a status word
  there.
- Tests (`ledger.test.ts:355-367`, next to the echo cases): delivered-then-sent
  stays delivered, delivered-then-read is read, read-then-delivered stays read.

### Files changed
`packages/chat-core/src/types.ts`, `packages/client-core/src/store/rows.ts`,
`packages/client-core/src/store/incoming.ts` (comment only),
`packages/client-core/src/store/ledger.test.ts` (3 new cases),
`apps/web/src/components/MessageTicks.tsx`,
`apps/mobile/src/components/chat/ticks.tsx`,
`apps/mobile/src/components/chat/message-bubble-content.tsx`,
`apps/mobile/src/components/chat/message-bubble-decor.tsx`.

### Commands
- `pnpm install`: ok (11.8s).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot
  src/store/ledger.test.ts`: 14 passed (11 existing + 3 new).
- `pnpm gate`: GATE PASS — format, lint, typecheck, effect, chat-core and
  client-core tests pass; web/mobile tests skipped (no nearby test files);
  scope check: every changed file inside Allowed files.

### Problems / deviations
- Spec §3 cites `index.css` tokens that don't exist under those names
  (`--seen`, etc.); used `text-online` (`--online: #22c55e`) instead and
  cited it. Mobile seen colour `#22c55e` likewise matches web rather than
  the list-row `#ededed`, because `#ededed` is invisible on the light
  outgoing bubble (`#dedede`).
- First gate run failed on format (my inserted `describe` collapsed a
  newline); fixed, re-ran, PASS.
- No screen changes until a message is `delivered`: no producer exists yet,
  and `sent`/`sending` render exactly as before.

### Security checklist
No routes, deletes, caps, tokens or audit entries touched. Ladder change is
a pure rank insert; `failed` stays outside it. N/A otherwise.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The change:**
  - `MessageStatus` gains `'delivered'`;
  - the ladder is sending, sent, delivered, read, and `failed` stays outside it;
  - delivered draws grey `CheckCheck` on both apps, and read draws green (web `text-online`, mobile `#22c55e`). **Julio chose green via AskUserQuestion.**
- **Lead checks after the rebase onto main:** the full client-core suite 113 of 113; `tsc` gives 0 errors for chat-core, client-core, web and mobile.
- **The follow-up (next task):** the mobile chat-list rows still draw seen in `#ededed` (`chat-list-item.tsx:144-147`, `topic-row.tsx:162-165`). Make them green, and use one shared colour constant instead of the hex.
