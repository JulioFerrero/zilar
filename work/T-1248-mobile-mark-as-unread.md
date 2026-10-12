---
id: T-1248
title: "TG-11 mobile: 'Mark as unread' / 'Mark as read' in the chat actions sheet, the unread dot on the list row, opening the chat clears it; the unreadMark mapping moves into chat-core applyChatPrefs so web and mobile share it"
status: merged
milestone: M5
branch: task/T-1248-mobile-mark-as-unread
model: auto
effort: default
depends_on: [T-1244]
estimate: 0.3 day
---

# T-1248: Mark as unread (mobile)

## Spec (written by Claude, do not edit)

### Why
T-1244 (merged) added `chat_prefs.unread_mark`, `unreadMark` on the contract `ChatPref` and the PUT payload, the server clearing it on every read mark, and the web UI. Mobile must match it.
- **The web copies the mark in its own overlay** (`apps/web/src/store/effects/prefs.ts:72-85`) and clears it locally on open (`apps/web/src/store/effects/history.ts:54-58`). Its pre-review follow-up asked to put the mapping in the shared `applyChatPrefs` (`packages/chat-core/src/chat-prefs.ts:60`), which mobile already uses (`apps/mobile/src/lib/chat-prefs.ts:2`, `apps/mobile/src/store/effects/history.ts:28`).
- **Mobile files:** the chat actions sheet (`apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `use-chat-actions.ts`), the row (`chat-list-item.tsx`) and the prefs API (`apps/mobile/src/lib/chat-prefs-api.ts`).

### What to build
1. **chat-core:** `applyChatPrefs` sets `unreadMark: true` on a chat whose own pref row has it (not inherited from a group's General row). `ChatPrefRow` gains `unreadMark?: boolean`.
   - Then remove the web's separate overlay (`prefs.ts:72-85`) and use the shared mapping, with the same behaviour; cite what changed.
   - Run the nearest chat-core prefs test if one exists (grep `applyChatPrefs` in `*.test.ts`), and update it if it pins the shape.
2. **Mobile prefs API:** `unreadMark` in the row type and the PUT patch.
3. **Mobile sheet** (`chat-actions-sheet.tsx` / `use-chat-actions.ts`):
   - "Mark as unread" when `unread === 0` and no mark;
   - "Mark as read" when `unread > 0` or the mark is set: the existing read path (cite it), plus clearing the pref.
   - Use lucide `Mail` / `MailOpen` icons.
4. **Row** (`chat-list-item.tsx`): a plain dot badge, with no count, when `unreadMark` and `unread === 0`, in the same spot and colours as the unread badge.
5. **Opening the chat** clears the mark locally at once, as the web does in `history.ts:54-58`; find mobile's open path and cite it. The server clears it through the read mark.
6. **Mock backend:** the mock read route also clears `unreadMark` (`packages/mock-backend/src/domains/chats/`), so the mock behaves like the server. That was T-1244's second follow-up.
7. **No new tests** (UI), apart from keeping an existing `applyChatPrefs` test green.

### Read first
`AGENTS.md`, `work/T-1244-mark-as-unread-server-web.md` (the Report and the Review), `packages/chat-core/src/chat-prefs.ts`, `apps/web/src/store/effects/prefs.ts`, `apps/web/src/store/effects/history.ts:40-70`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `apps/mobile/src/components/chat/chat-list-item.tsx` and `apps/mobile/src/lib/chat-prefs-api.ts`.

### Allowed files
`apps/mobile/src/components/chat/chat-actions-host.tsx` (added by the lead), `packages/chat-core/src/chat-prefs.ts`, `packages/chat-core/src/**/*.test.ts`, `packages/chat-core/src/types.ts`, `apps/web/src/store/effects/prefs.ts`, `apps/web/src/store/effects/history.ts`, `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/lib/chat-prefs.ts`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/store/**`, `packages/mock-backend/src/domains/chats/**`, `packages/mock-backend/src/domains/chat-prefs/**`, `work/T-1248-mobile-mark-as-unread.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):**
  - the sheet offers Mark as unread, and the row then shows the dot;
  - opening the chat clears it.
- **The web still behaves the same:** the lead rechecks the web mock.

---

## Report (written by the worker when done)

### What I did

- **chat-core (`packages/chat-core/src/chat-prefs.ts`):** `ChatPrefRow` gains `unreadMark?: boolean | undefined`; `applyChatPrefs` now sets `unreadMark: true` on a chat whose **own** pref row has it and deletes it otherwise (never inherited from a group General row, matching the web behaviour); `stripPref` drops `unreadMark` too. Comment updated.
- **Web (`apps/web/src/store/effects/prefs.ts`, `history.ts`):** removed the separate `unreadMark` overlay body; `paint` and `refreshChats` call the shared `applyChatPrefs`. `lifecycle.ts` (`applyBoot`) and `groupCreate.ts` (`repaintCreatedGroup`) are **outside** this task's Allowed files but import `applyPrefsWithUnreadMark`, so that name is kept in `prefs.ts` as a one-line alias of `applyChatPrefs` (no second mapping). Behaviour is unchanged.
- **Mobile prefs API (`chat-prefs-api.ts`):** `ChatPref.unreadMark?: boolean | undefined` in the row type and `PutChatPrefInput.unreadMark?: boolean | undefined` in the PUT patch.
- **Mobile optimistic row (`lib/chat-prefs.ts`):** `optimisticPrefRow` carries `unreadMark` (`input.unreadMark ?? existing?.unreadMark ?? false`), so the dot does not flash off during an unrelated pref write.
- **Mobile store (`store/effects/events.ts`, `store/types.ts`):** new `markChatRead(chatId)` action — runs the shared `recordRead` (the existing read path, `@zilar/client-core/store`) and then clears the pref via `updatePref` (`{ unreadMark: false }`).
- **Opening the chat (`store/effects/history.ts` `openChat`):** after `h.recordRead`, if the chat is marked, clears `unreadMark` locally at once and forks a pref write `{ unreadMark: false }` (mirrors `apps/web/src/store/effects/history.ts`), so the mark clears even when no numeric last-read id exists to send.
- **Row (`chat-list-item.tsx`):** plain dot (no count) when `unreadMark === true && unread === 0`, in the unread badge's spot and colours (`primaryKey` / `raisedPill`, keyed like the badge to avoid a live gradient swap).
- **Sheet/hook (`chat-actions-sheet.tsx`, `use-chat-actions.ts`):** "Mark as read" when `unread > 0 || unreadMark`, else "Mark as unread", using lucide `MailOpen` / `Mail`; hook exposes `markUnread` (pref `true`) and `markRead` (the store action), reusing the existing busy/close/error path (generalised `runPrefSave`).
- **Host (`chat-actions-host.tsx`, added to Allowed files by the lead):** forwards `onMarkUnread` / `onMarkRead` to the sheet from `markUnread` / `markRead`.
- **Mock backend (`packages/mock-backend/src/domains/chats/routes.ts`):** added `PUT /chats/:jid/read` (204) which clears the caller's `unreadMark` like the server's `putChatRead`.

### Blocked / needs a decision (resolved)

I first stopped: the sheet's new handlers had to be wired in `apps/mobile/src/components/chat/chat-actions-host.tsx`, which was not in the Allowed files. The lead added it on the branch (`d62588baa T-1248 spec: allow chat-actions-host`); I wired it and made the sheet's `onMarkUnread` / `onMarkRead` required again, so the item always renders. No further decision needed.

(Note: the web overlay could be removed in scope only by keeping the `applyPrefsWithUnreadMark` alias, because `lifecycle.ts`/`groupCreate.ts` are outside the Allowed files too.)

### Commands I ran

- `pnpm install` — Done (10.6s).
- `pnpm gate` (from the repo root) — summary:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (0.8s)
  PASS  tests @zilar/mobile  (3.2s)
  SKIP  tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web  (3.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

No single test file was run separately: `grep applyChatPrefs **/*.test.ts` finds no test that pins `applyChatPrefs` (the spec's "nearest chat-core prefs test if one exists" does not exist), and the mock/chats change has no nearby test file.

### Deviations from the spec

1. The web override was removed in substance; the `applyPrefsWithUnreadMark` **name** is kept as an alias of `applyChatPrefs` because two out-of-scope callers (`lifecycle.ts`, `groupCreate.ts`) still import it.

### Open questions

None.

### Round (fix round, T-1248)

- **Finding 1 (should-fix, history.ts over 400 lines): fixed.** Moved the
  `openChat` clear-mark block into an exported `clearUnreadMarkOnOpen(ctx, chatId)`
  helper in `apps/mobile/src/store/effects/events.ts` (next to `markChatRead`),
  and `openChat` now just calls `clearUnreadMarkOnOpen(ctx, chatId)` after
  `h.recordRead`. `apps/mobile/src/store/effects/history.ts` is back to 396
  lines (≤ 400); `events.ts` is 209 lines. The helper is a free function
  (not an `Events` method) because `makeHistory` runs before `makeEvents` and
  does not receive the `Events` instance.
- **Finding 2 (nit): not touched** — `markChatRead`'s silent return stays as
  the review left it. **Finding 3 (nit): not touched** — the helper keeps the
  finding's own snippet (`{ ...chat, unreadMark: false }`).
- **Tests:** the fix is behaviour-preserving, so no test was added or changed.
  Ran `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/store/real-store.history.test.ts src/store/real-store.lifecycle.test.ts
  src/store/real-store.incoming.test.ts` — 3 files, 23 tests, all pass.
- **Gate:** `pnpm gate` from the repo root — summary:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (1.0s)
  PASS  tests @zilar/mobile  (4.4s)
  SKIP  tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web  (4.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (2 nits, 2 follow-ups).**
- **The change:**
  - `unreadMark` mapping moved into chat-core `applyChatPrefs`, so the web overlay is gone and both apps share it;
  - mobile sheet: Mark as unread / Mark as read (`chat-actions-sheet.tsx`, wired in `chat-actions-host.tsx`);
  - the list row shows the dot;
  - the mock read route clears the mark.
- **Lead's emulator check (mock build, SMOKE PASS):**
  - long-pressing Marta shows Pin, Mute, Archive and Mark as unread;
  - tapping it puts a dot on Marta's row;
  - opening the chat and going back clears the dot.
