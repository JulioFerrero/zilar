---
id: T-1722
title: "Routine live message, step 4 (clients): a message with a `routine` payload shows the board's header (repeat icon, title, schedule; tap opens Settings › Routines) above its text on web and phone, and an edit carrying the routine payload bumps the chat (moves it to the top with the new preview, and counts as unread) — Julio 2026-10-16 'Bump the chat'"
status: merged
milestone: M5
branch: task/T-1722-routine-header-bump
model: auto
effort: default
depends_on: [T-1721]
estimate: 60 min
---

# T-1722: The routine header and the chat bump

## Spec (written by Claude, do not edit)

### Why
The approved board `docs/design/mockups/routines/WebRoutineLive.dc.html` (and `PhoneRoutineLive.dc.html`) shows the routine's single message with a header link above its content:
- a repeat icon;
- the routine title, muted and 13 px;
- the schedule in mono on the right.

Julio chose that **each run bumps the chat**: the chat moves up with the new preview and counts as new activity. T-1721 puts a `routine` payload `{ id, title, schedule }` on the routine message and on every edit of it. Read the boards (`git show main:docs/design/mockups/routines/WebRoutineLive.dc.html`) first.

### Facts (the lead read them on 2026-10-16)
- **Incoming payloads:** `packages/client-core/src/store/ledger-incoming.ts:191-204`. Every payload except `voice` and `attachment` becomes `ui.card = message.payload`, so a routine message arrives with `message.card.type === 'routine'`.
- **The web bubble:** `apps/web/src/components/MessageBubble.tsx` (381 lines) draws headers before the body: `ForwardedHeader` at `:296-302` and the `ReplyQuote` at `:304-308`, then `AttachmentBody` and `MessageTextBody` (`:313-339`).
  - `AttachmentBody` draws only the `progress`, `approval.request` and `question` cards, so a `routine` card draws nothing there and the text body shows as usual.
- **The phone bubble:** `apps/mobile/src/components/chat/message-bubble-content.tsx` (334 lines) draws `ForwardedHeader` and `ReplyQuote` (`:160-169`), then the media, card or text branch.
  - `isRenderedCard` (`apps/mobile/src/components/chat/payload-card.tsx:56-63`) excludes `routine`, so the text body shows.
- **Edits don't move chats today.** `packages/client-core/src/store/ledger-edits.ts:112-128` (`ingestEdit`): "A correction or retraction message only changes edit state; it never touches the preview or the unread count."
  - `cardEditFor` (`:67-82`) only treats `progress` payloads as card edits.
  - A new message moves its chat to the top and sets `lastMessage` in `setChatMessage` (`ledger-incoming.ts:212-231`, with `moveChatToTop`).

### Steps
1. **client-core `ledger-edits.ts`:** in `ingestEdit`, when the correction carries a payload with `type === 'routine'`, after the edit applies, bump the chat:
   - move it to the top;
   - set its `lastMessage` to the edited target message (the corrected text);
   - raise its unread count **the same way a new incoming message from someone else does in this store**. Find that path (grep `unread`). If unread comes only from the server's chat list, do just the move and the preview, and say so in the Report.

   Own messages never count as unread. Keep the file under 400 lines; if it would pass 400, put the bump in a small helper file next to it (add it to the task file's Allowed files).
2. **Web:** new `apps/web/src/components/message/RoutineHeader.tsx`, drawn in `MessageBubble.tsx` right after the forwarded and reply headers when `message.card?.type === 'routine'`:
   - a link row to `/settings/routines`;
   - a `Repeat` icon, the title in muted 13 px medium, and the schedule in mono 12 px muted on the right, as on the board.
3. **Phone:** new `apps/mobile/src/components/chat/routine-header.tsx`, drawn in `message-bubble-content.tsx` at the same place:
   - a `Pressable` that pushes `/settings/routines`;
   - the same contents as on web;
   - at least 24 px tall, in a bubble at least 44 px tall overall.
4. **Test** (message pipeline): one client-core case in the existing ledger edit tests (find the file that tests `ingestEdit`, for example `ledger.test.ts`). A correction with a `routine` payload moves its chat to the top and updates `lastMessage`; a plain correction still doesn't.

### Allowed files
- `packages/client-core/src/store/ledger-edits.ts`
- `packages/client-core/src/store/ledger-routine-bump.ts`
- `packages/client-core/src/store/ledger.test.ts`
- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/incoming.test.ts`
- `apps/web/src/components/message/RoutineHeader.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/mobile/src/components/chat/routine-header.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `work/T-1722-routine-header-bump.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The header:** a routine message shows the routine header above its text on web and phone, and tapping it opens Settings › Routines.
- **The bump:** a routine edit moves the chat to the top with the new text as its preview, and counts as unread where the store does that.
- **The new test passes.**

---

## Report (written by the worker when done)

### What I did

**client-core — the bump (`ledger-edits.ts`, new `ledger-routine-bump.ts`).**
`ingestEdit` now bumps the chat when the correction carries a `payload` with
`type === 'routine'`, after the edit applies: the chat moves to the top and its
`lastMessage` is the edited target message with the corrected text as its
preview. The unread count is raised the same way a new incoming message from
someone else does (`incoming.ts:184`: `chat.unread + 1`), except when the edit
is my own — `isMine` compares `author.jid` with `state.me.jid`, the same test
`incoming.ts`/`ledger-identity.ts` use — so own edits never count.

Because the bump pushed `ledger-edits.ts` past 400 lines, it lives in a small
new helper file `packages/client-core/src/store/ledger-routine-bump.ts`
(`createRoutineBump`), which the spec allows. I added that file to the task's
Allowed files. `ledger-edits.ts` is now 390 lines.

**Deviation on unread (one detail of the spec's step 1).** `incoming.ts`'s local
bump also zeroes the count while the chat is the open, visible one
(`isRead = activeChatId === chatId && ports.isVisible()`). That state lives on
`CoreCtx`, not on `LedgerState`, and the ledger is not given it; also
`incoming.ts:105-107` ingests an edit *before* it reaches the unread path. So the
bump here is `chat.unread + 1` for a non-own edit unconditionally — it cannot
clear an open chat's count the way the live-message path does. This is the
"do just the move and the preview" caveat: I did move + preview + unread, but
without the visibility test. Own edits are excluded, per the spec.

**Web.** New `apps/web/src/components/message/RoutineHeader.tsx`: a `<Link>` to
`/settings/routines` with the `Repeat` icon, the title in muted 13 px medium
(`text-[13px] font-medium text-muted-foreground`) and the schedule in mono 12 px
on the right, as on `WebRoutineLive`. Drawn in `MessageBubble.tsx` right after
the forwarded and reply headers when `message.card?.type === 'routine'`.

**Phone.** New `apps/mobile/src/components/chat/routine-header.tsx`: a
`Pressable` (accessibilityRole `link`) that pushes `/settings/routines`, the
same contents (title 13 px medium muted, schedule mono 12 px muted), `min-h-6`
(24 px) tall so the bubble clears 44 px. Drawn in
`message-bubble-content.tsx` after the forwarded and reply headers when
`message.card?.type === 'routine'`.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`
  → `Test Files 1 passed (1)`, `Tests 19 passed (19)`. This is the
  AGENTS-prescribed form of the task's first check (the task's literal command
  omits `--maxWorkers=2`, which AGENTS forbids me to run).
- `pnpm gate` (from the repo root) → ended `GATE PASS`, summary lines:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.6s)
PASS  lint  (1.8s)
PASS  typecheck  (8.4s)
PASS  effect  (1.7s)
PASS  tests @zilar/client-core  (20.0s)
PASS  tests @zilar/mobile  (3.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The new test `describe('the message ledger: the routine edit bump (T-1722)')`
has three cases: a routine correction moves the chat to the top, sets the
corrected text as `lastMessage` and unread to 1; a plain correction moves
nothing and leaves `lastMessage` undefined and unread 0; an edit of my own
routine message bumps the preview but unread stays 0.

### Files changed

- `packages/client-core/src/store/ledger-edits.ts` (modified)
- `packages/client-core/src/store/ledger-routine-bump.ts` (new, added to Allowed files)
- `packages/client-core/src/store/ledger.test.ts` (modified)
- `apps/web/src/components/message/RoutineHeader.tsx` (new)
- `apps/web/src/components/MessageBubble.tsx` (modified)
- `apps/mobile/src/components/chat/routine-header.tsx` (new)
- `apps/mobile/src/components/chat/message-bubble-content.tsx` (modified)
- `work/T-1722-routine-header-bump.md` (this task file)

### Notes for the lead

- **Unread:** as above, the bump cannot run the `isRead` (open + visible) part
  of `incoming.ts`'s path from the ledger, because `LedgerState` carries no
  `activeChatId`/visibility and edits never reach that code. If you want an
  open chat to stay at unread 0, the edit path would need the visibility test
  threaded into the ledger (a change to `ledger.ts`/`incoming.ts`, outside this
  task's Allowed files). Say the word and I'll do it in a follow-up.
- **History edits:** `ingestHistoryEdits` calls `ingestEdit`; round 1 bumped on
  history too (a routine correction loaded from an old page moved the chat).
  That was F1: it is now gated to live stanzas — see Round 2 below.
- UI only: the header uses the routine payload's `schedule` string as-is (T-1721
  already stores it in words, e.g. "every 5 min"); no `describeSchedule` call
  here.
- No new dependencies; no migrations.

### Round 2 — fix findings 1 and 4 (fix round)

**F1 (must-fix) — bump is now live-only.** `ingestEdit(message, bumpRoutine = true)`
keeps the bump for live stanzas; `ingestHistoryEdits` calls `ingestEdit(message, false)`,
so a routine correction read back from history (boot `loadPreview`, `openHistory`,
`loadOlderPage`) no longer reorders the chat or inflates its count. Test added in
`ledger.test.ts`: `does not bump when the routine correction comes from history`.
`ledger-edits.ts` is 398 lines, under the 400 cap.

**F4 (should-fix) — bump only when the edit applied.** `applyEditUpdate` now returns
whether `applyEdit` changed the edit state for the target (`applyEdit` returns the
state unchanged for a foreign author or an already-retracted target), and `ingestEdit`
bumps only when that is `true`. The guard also opens with `update.kind === 'correction'`,
so a retraction can never bump. Test added in `ledger.test.ts`:
`does not bump when the routine correction is not from the author`.

**Checks (round 2).**
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`
  → `Test Files 1 passed (1)`, `Tests 21 passed (21)` (19 before, +2 this round).
  The AGENTS form of the task's first check (the task's literal command omits
  `--maxWorkers=2`, which AGENTS forbids).
- `pnpm gate` (from the repo root) → ended `GATE PASS`:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.6s)
PASS  lint  (0.8s)
PASS  typecheck  (2.4s)
PASS  effect  (0.7s)
PASS  tests @zilar/client-core  (5.6s)
PASS  tests @zilar/mobile  (1.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Commits this round: `T-1722: fix finding 1 - gate the routine bump to live edits`,
`T-1722: fix finding 4 - bump only when the routine correction applied`.

### Round 3 — fix finding 1 (fix round)

**Finding 1 (should-fix) — a duplicate or stale routine correction no longer
bumps.** `applyEdit` (`packages/chat-core/src/edits.ts`) returns a fresh state
object even when it stores nothing new: for a stale-order correction (`:197-199`)
and for a byte-identical re-apply. The guard in `applyEditUpdate` used reference
equality (`after !== before`), so a routine correction redelivered on an XMPP
stream resumption, or one older than the stored correction, bumped the chat
again (unread 1 → 2, chat re-moved) for one run. The guard now compares the
stored correction itself through a new `correctionChanged(before, after)` helper
in `ledger-routine-bump.ts` (same text and order means nothing changed), so only
a correction that actually lands bumps. `ledger-edits.ts` stays at 398 lines.

Tests added in `ledger.test.ts`:
- `does not count a redelivered routine correction as unread again` — the exact
  scenario in the finding; re-feeding the same correction stanza leaves the chat
  at unread 1 with the same preview.
- `does not bump for a routine correction older than the stored one` — a routine
  correction with an older stanza order changes nothing.

Both fail against the old reference-equality guard (verified by temporarily
restoring it: `2 failed | 21 passed`), so they are not vacuous.

**Checks (round 3).**
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`
  → `Test Files 1 passed (1)`, `Tests 23 passed (23)` (21 before, +2 this round).
- `pnpm gate` (from the repo root) → ended `GATE PASS`:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.6s)
PASS  lint  (1.1s)
PASS  typecheck  (2.2s)
PASS  effect  (0.5s)
PASS  tests @zilar/client-core  (5.7s)
PASS  tests @zilar/mobile  (1.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Commit this round: `T-1722: fix finding 1 - skip the routine bump when the
correction changes nothing`.

**Not this round.** Findings 2 and 3 are nits and not in lines this round
changes, so they are left as they are. The follow-up (an open, visible chat is
still inflated; zeroing it needs `ledger.ts`/`incoming.ts`) stays outside the
Allowed files.

### Round 4 — fix finding F2 (fix round)

**F2 — a routine edit in the open, visible chat no longer adds unread.** A live
message in the chat I am looking at is read (`incoming.ts:156`), but the edit
path returned at `incoming.ts:105-107` before that test, so
`bumpRoutineChat` (`ledger-routine-bump.ts`) added 1 unread for every non-own
routine correction — one a minute for a live routine. `handleMessage` now, after
`k.ingestEdit(message)` and only when `message.payload?.type === 'routine'` and
`ctx.get().activeChatId === message.chatJid && ctx.ports.isVisible()` (the same
test the live path uses), calls `recordRead(ctx, message.chatJid,
message.correction?.targetId)` like the carbon path at `:96`, which clears the
chat's `unread` and records the read. `incoming.ts` is 345 lines.

Test added in `incoming.test.ts` (the file that already covers `handleMessage`
for the open chat): `reads a routine correction in the open, visible chat
without unread`. It feeds a routine message, then a routine correction, and
asserts `unread` stays 0, the preview follows the correction and
`ctx.lastRead[ANA]` is the corrected target id. It fails against the pre-fix
`incoming.ts` (verified by stashing only that file: `1 failed | 26 passed`), so
it is not vacuous.

`incoming.ts` and `incoming.test.ts` were added to the task's Allowed files.

**Checks (round 4).**
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/incoming.test.ts`
  → `Test Files 2 passed (2)`, `Tests 50 passed (50)`.
- `pnpm gate` (from the repo root) → ended `GATE PASS`:

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (1.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/client-core  (5.0s)
PASS  tests @zilar/mobile  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Commit this round: `T-1722: fix finding F2 - keep a routine edit in the open
chat read`.

### Disagreements

- **F3 (nit) — the premise does not match the code, no change.** The review says the
  bump "fires for retractions too" because "the guard only checks `payload?.type ===
  'routine'`". The guard at `deb83f6` already required `message.correction !== undefined`,
  which is false for a retraction (`editUpdateFor` returns a retraction only when
  `message.retraction !== undefined`, and a stanza has one or the other), so a
  retraction never bumped. The F4 change additionally gates on
  `update.kind === 'correction'`, so this is now explicit.
- **F5 (nit) — not fixed, out of scope and not in a line I changed.** Deduping a resent
  routine correction needs the resend check on the live path (`incoming.ts:105-107`),
  which is outside this task's Allowed files. Rare; leaving as a nit.
- **F6 (nit) — not fixed.** The weak `lastMessage` assertion in the plain-correction
  case is real, but that is a nit and not in a line this round changed.
- **F7 (nit) — verified, no change.** `apps/mobile/src/app/settings/routines.tsx` and
  the web `/settings/routines` route both exist on `main` but not at this branch's
  base; they resolve once the lead rebases/merges.
- **F2 (follow-up) — not addressed.** Zeroing an open, visible chat's count needs
  visibility/active-chat state threaded into the ledger (`ledger.ts`/`incoming.ts`,
  outside Allowed files), exactly as the review states.
- **Update (round 3).** The earlier F5 note — that deduping a resent routine
  correction needs the resend check in `incoming.ts`, outside the Allowed files —
  was too pessimistic. Round 3's finding 1 is fixed inside the Allowed files by
  comparing the stored correction before and after `applyEdit`; no change to
  `incoming.ts` is needed.

## Review (written by Claude)

**Approved and merged** after two automatic rounds and one lead round. Julio chose "Bump the chat" on 2026-10-16.

- **Fixed in the rounds:**
  - an old page loaded from history never bumps;
  - only a correction that actually applied bumps (no foreign author, stale order or duplicate);
  - retractions don't bump;
  - a routine edit in the open, visible chat counts as read (`incoming.ts`), the same as a live message there.
- **Accepted as is:** the last should-fix, that `recordRead` can also fire for an ignored routine retraction or correction in the open chat. Its only effect is that the chat the user is already looking at counts as read, so it's harmless.
- **The header:** `RoutineHeader` on web and `routine-header.tsx` on the phone open Settings › Routines. The phone route exists on main (T-1720).
- **Size:** `ledger-edits.ts` is 398 lines and the bump lives in `ledger-routine-bump.ts`.

