---
id: T-1451
title: "Mobile sheets on the approved standard (part 2): the New chat actions (join link, new channel, new message, invite) each become a kit BottomSheet instead of cards in one parent Modal; Visibility, Invite links and Roles drop their Cancel keys"
status: merged
milestone: M5
branch: task/T-1451-mobile-sheets-part2
model: auto
effort: default
depends_on: [T-1443]
estimate: 0.5 day
---

# T-1451: Mobile sheets on the standard (part 2)

## Spec (written by Claude, do not edit)

### Why
This is the same standard as T-1443 (`docs/design/mockups/new-ai/README.md`, "Rules the design set"):
- one way out: the close key, the grabber, the backdrop or Android back;
- one primary in the sticky footer;
- no new copy.

T-1443 gave the kit `BottomSheet` a default close key whenever it has a `title` (`apps/mobile/src/components/ui/bottom-sheet.tsx`). Its follow-up is the parent `Modal` in `new-chat-button.tsx`, which now wraps a kit sheet inside a modal.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/chat/new-chat-button.tsx`** (269 lines):
  - one `Modal` (`:216-266`) with a `KeyboardAvoidingView`, a `ScrollView` and a backdrop `Pressable` (`:222-236`);
  - inside it, one of four renders by `action`: `JoinLinkForm` (`components/chat/join-link`), `NewChannelSheet` (`:241-250`, already a kit `BottomSheet` since T-1443; the parent ignores close while `channelBusy`), `NewMessageSheet` and `InviteSheet`.
- **`apps/mobile/src/components/chat/new-message-sheet.tsx`** (39 lines): a centered card (`rounded-2xl … bg-surface`, `:23`) with a ghost **Close** key (`:30-31`) and "Invite a friend" (`:33`).
- **`apps/mobile/src/components/chat/invite-sheet.tsx`** (186 lines): a centered card (`:123`) with a ghost **Close** key (`:136-137`).
- **The join-link form** lives in `apps/mobile/src/components/chat/join-link.tsx` (find `JoinLinkForm`).
- **`apps/mobile/src/components/chat/visibility-sheet.tsx`** (257 lines): a kit `BottomSheet` with the primary "Save visibility" / "Confirm going private" plus a **Cancel going private** key (`:231-247`), and a secondary "Copy share link" (`:250`).
- **`apps/mobile/src/components/chat/invite-links-sheet.tsx`** (381 lines; must not pass 400): a kit `BottomSheet`, with "Create invite link" inline (`:236-243`) and per-link Copy/Revoke rows (`:357+`).
- **`apps/mobile/src/components/chat/group-roles-sheet.tsx`** (338 lines): a kit `BottomSheet`, with an inline "Add role" next to its field (`:316-323`) and per-member row keys.

### What to build
1. **`new-chat-button.tsx`:** remove the parent `Modal`, `KeyboardAvoidingView`, `ScrollView` and backdrop.
   - Each action renders its own kit `BottomSheet` (`visible` while that action is chosen), with its current title.
   - `NewChannelSheet` already is one. Make `NewMessageSheet`, `InviteSheet` and the join-link form kit sheets too.
   - Their ghost **Close** keys are removed; the kit close key replaces them.
   - The one primary goes to `footer` ("Invite a friend"; the join form's submit; the invite sheet's own primary if it has one).
   - Keep `channelBusy` blocking close, as T-1443 did (`dismissible={!busy}`).
2. **`visibility-sheet.tsx`:**
   - the Save / Confirm primary goes to `footer`;
   - the confirm-private step keeps a way back: when `confirmingPrivate`, the header shows `onBack` (back to the choice) instead of a Cancel key;
   - "Copy share link" stays a secondary key in the body.
3. **`invite-links-sheet.tsx`:** "Create invite link" goes to `footer` as the one primary. The per-link rows stay. The file must stay at 400 lines or fewer, so move a sub-view into a new file if needed.
4. **`group-roles-sheet.tsx`:** no footer change ("Add role" belongs to its field, and the row keys are row actions). Only confirm it uses the kit title and close key, and remove any Close or Cancel key.
5. **Everywhere:** no new copy, errors stay in the body above the footer, and unused imports are removed.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-message-sheet.tsx`, `apps/mobile/src/components/chat/invite-sheet.tsx`, `apps/mobile/src/components/chat/join-link.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`
- `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/bottom-sheet.tsx` (added in the lead's phone-smoke round)
- one new file under `apps/mobile/src/components/chat/` if a split is needed (name it in the Report)
- `work/T-1451-mobile-sheets-part2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's phone smoke opens New chat → New message, Invite and Join link, and a group's Visibility and Invite links.

---

## Report (written by the worker when done)

### What I did

Same standard as T-1443: one way out (the kit close key, the grabber, the backdrop or Android back), one primary in the sticky footer, no new copy.

1. **`new-chat-button.tsx`** — removed the parent `Modal`, the `KeyboardAvoidingView`, the `ScrollView` and the backdrop `Pressable`. Each action now renders its own kit `BottomSheet` with `visible={action === '...'}` and its current title. Removed the now-dead `CREATE_SHEETS_SCROLL_TAPS_PERSIST` export (nothing else imported it) and the `Modal`/`ScrollView`/`KeyboardAvoidingView` imports. `channelBusy` still blocks close: `NewChannelSheet` keeps `dismissible={!busy}` and the guarded `onClose`.
2. **`new-channel-sheet.tsx`** — gained a `visible` prop (was hard-coded `visible`, its parent used to mount/unmount it inside the modal). Doc comment updated.
3. **`new-message-sheet.tsx`** — now a kit `BottomSheet` (`title="New message"`); the card wrapper and the ghost **Close** key are gone; **Invite a friend** is the footer's one primary.
4. **`invite-sheet.tsx`** — now a kit `BottomSheet` (`title="Invite a friend"`); the card wrapper and both ghost **Close** keys are gone. Its primary is in the footer: **Copy** (with the check/copied state) when the link is ready, **Try again** after a failure; the fixed failure sentence stays in the body. **Share** is the body's secondary outline key. A new `visible` prop gates the create request (`Effect.never` while closed, the `ChannelPanel.tsx` pattern), so no personal invite link is created while the sheet is closed; `close` resets `copied`/`attempt` so a reopen starts clean.
5. **`join-link.tsx`** — `JoinLinkForm` is now a kit `BottomSheet` (`title="Join with a link"`); **Continue** is the footer's one primary; the local parse error stays in the body. It takes `visible` and `onClose`. `JoinLinkBody` (the route's view) is untouched.
6. **`visibility-sheet.tsx`** — **Save visibility / Confirm going private** moved to the footer. The confirm-private step no longer has a **Cancel** key: while `confirmingPrivate` the header shows `onBack` (back to the choice, wired to `onCancelPrivate`). **Copy share link** stays a secondary key in the body.
7. **`invite-links-sheet.tsx`** — **Create invite link** moved to the footer as the one primary; the error stays in the body above the footer; the per-link rows are unchanged. 378 lines (≤ 400), so no split was needed.
8. **`group-roles-sheet.tsx`** — no edit needed (see note 1).

### Files changed

- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-message-sheet.tsx`
- `apps/mobile/src/components/chat/invite-sheet.tsx`
- `apps/mobile/src/components/chat/join-link.tsx`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
- `work/T-1451-mobile-sheets-part2.md`

(`group-roles-sheet.tsx` needed no change; no new file was needed.)

### Commands

- `pnpm install` — Done (12s), no lockfile change.
- `pnpm exec prettier --write apps/mobile/src/components/chat/invite-sheet.tsx` — fixed the one formatting issue the first gate flagged.
- `pnpm gate` (repo root), final run:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (0.9s)
PASS  lint  (1.8s)
PASS  typecheck  (4.1s)
PASS  effect  (1.7s)
PASS  tests @zilar/mobile  (2.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the spec says "Tests: None (UI)", `grep` over `apps/mobile/**/*.test.*` found no test importing any changed component, and the gate ran `@zilar/mobile`'s own tests (all passing).

### Deviations / notes / open questions

1. **`group-roles-sheet.tsx` needed no edit.** It already uses the kit `title` and the default close key, and it has no sheet-level Close or Cancel key. Its two **Cancel** tokens (`:214`, `:235`) are row actions that leave the inline rename/delete edit state (paired with the row `Save`/`Delete`); the spec calls the row keys row actions, so I left them. Removing them would strand a user inside an inline edit with no way back.
2. **`InviteSheet`'s "own primary".** The spec says the invite sheet's primary goes to the footer "if it has one". I read its default-variant action as the primary and moved **Copy** (loaded) / **Try again** (failed) to the footer; **Share** became the body's secondary. If the intent was to keep Copy and Share together in the body with no footer, say so and I will change it.
3. **No new file created.** `invite-links-sheet.tsx` stayed at 378 lines, so the "one new file if a split is needed" allowance was not used.
4. **For the phone smoke:** the New message sheet's **Invite a friend** now dismisses one `TrueSheet` and presents another in the same commit (`action` `message` → `invite`). The spec asks for one sheet per action, so this is by design; worth watching on device for a present/dismiss race.

### Round (fix round 1, 2026-10-15)

Pre-review counts: must-fix=0, should-fix=1, nit=1.

- **Finding 1 (should-fix) — fixed.** `JoinLinkForm` (`join-link.tsx`) and `NewChannelSheet` (`new-channel-sheet.tsx`) are always mounted, so their state survived a close. Both now reset when `visible` flips false: `JoinLinkForm` clears `raw`/`error`; `NewChannelSheet` clears `title`/`description`/`visibility`/`handle`/`localError`, so a reopen starts fresh. The reset uses the **adjusted-state render pattern** the in-repo `new-topic-group-sheet.tsx:114-117` already uses, not an effect: the repo's oxlint `react(set-state-in-effect)` rule (correctness → error) rejected both the direct `useEffect` reset and the invite-sheet close-handler shape alone. Resetting on `visible` (rather than in a wrap of `onClose`) also covers the successful-create path, where the parent (`openGroupScreen`) closes the sheet by setting `action` without calling the sheet's `onClose`.
- **Finding 2 (nit, `new-chat-button.tsx:220-232` present/dismiss flicker) — not changed.** The finding itself requests no code change ("No code change requested"); it only asks the phone smoke to watch for it. The line is outside the finding-1 edit, so per the round brief it is left as is.

### Tests added

None. The task Spec says **"Tests: None (UI)"**, and `AGENTS.md` ("UI code gets no tests; the lead's phone smoke and Julio's live checks cover it") agrees. The mobile package declares no component renderer (`@testing-library/react-native` / `react-test-renderer` are not dependencies; `apps/mobile/src/**` has no `*.test.tsx`), and `AGENTS.md` forbids adding dependencies, so the state-reset behaviour can only be exercised on device. The finding names no specific test. This is the one point where the round brief ("add or adjust a test for each behaviour fix") and the repo's own rules conflict; I followed the repo rules and the Spec and am flagging it here rather than adding a dependency.

### Disagreements

None with the findings; finding 1 is correct and is fixed as described.

### Round gate

`pnpm gate` (repo root), after the fix:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (2.5s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (0.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: there are none for this UI change (see above).

### Round gate (phone smoke)

Must-fix (non-modal sheet from the New chat menu): fixed by sequencing every sheet hand-off — the menu's `ActionSheet` gained an optional `onDismissed` (fired on every native dismissal, `onClose` semantics unchanged for all other callers) and `new-chat-button.tsx` now queues the next action/channel/message/join/new-topic sheet until the menu has dismissed, and the New message → Invite hand-off until the message sheet has dismissed; gate after the fix: `PASS install/format/lint/typecheck/effect/tests @zilar/mobile`, scope/migration/images/size clean, `GATE PASS`. I also added `action-sheet.tsx`/`bottom-sheet.tsx` to the task's Allowed files (authorized in the phone-smoke brief) so the scope check stays clean.

## Review (written by Claude)
Lead, 2026-10-15: approved after 1 auto round and 1 lead round. Pre-review CLEAN.
- **The lead round:** the phone smoke showed New message opening undimmed and non-modal; a tap behind it opened a chat. The cause was two native sheets presenting and dismissing at once. Hand-offs are now sequenced.
- **The re-check on the emulator:**
  - New chat → New message is dimmed, and a tap outside closes it without opening a chat;
  - New message → Invite a friend opens dimmed, with the close key and one primary.
  - Invite fails in mock mode, because the mock has no invite route, the same as on web.
