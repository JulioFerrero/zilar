---
id: T-2231
title: "Rewrite map (no code change), messages core D: chat list, new chat, requests, folders, prefs, unread and delivery on web, phone and server. Behaviour list, twin logic, slop, lean target with budgets"
status: merged
milestone: M5
branch: task/T-2231-audit-messages-chat-list
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2231: Rewrite map, the chat list

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

### Scope (6,743 lines, counted 2026-10-19)
- `apps/web/src/components/ChatList.tsx` (606)
- `apps/mobile/src/components/chat/new-chat-button.tsx` (601)
- `apps/server/src/chats/api.ts` (594)
- `apps/mobile/src/components/chat/chat-list.tsx` (579)
- `apps/mobile/src/components/chat/chat-rows.tsx` (444)
- `apps/server/src/chats/unread.ts` (400)
- `apps/web/src/components/NewChatButton.tsx` (355)
- `apps/server/src/chat-folders/service.ts` (307)
- `apps/server/src/chat-prefs/service.ts` (297)
- `apps/server/src/chats/deliveries.ts` (286)
- `apps/web/src/components/chatList/RequestRows.tsx` (273)
- `apps/mobile/src/components/chat/request-rows.tsx` (265)
- `apps/web/src/components/ChatListItem.tsx` (200)
- `apps/web/src/components/chatList/ChatListMenu.tsx` (199)
- `packages/api-contract/src/chat-folders.ts` (150)
- `packages/chat-core/src/chat-prefs.ts` (149)
- `apps/server/src/chat-folders/api.ts` (142)
- `apps/server/src/chats/reads.ts` (125)
- `apps/server/src/chat-prefs/api.ts` (125)
- `apps/server/src/chat-prefs/access.ts` (124)
- `apps/server/src/chats/delivered-notice.ts` (123)
- `packages/api-contract/src/chat-prefs.ts` (110)
- `apps/mobile/src/lib/chat-list.ts` (82)
- `apps/web/src/components/chatList/rowsSelector.ts` (68)
- `apps/web/src/components/chatList/RowActions.tsx` (40)
- `apps/mobile/src/lib/chat-folders-api.ts` (33)
- `apps/mobile/src/components/chat/unread-badge.tsx` (26)
- `apps/mobile/src/lib/chat-prefs-api.ts` (25)
- `apps/mobile/src/lib/chat-prefs.ts` (15)

Read every file in scope fully. Read a file outside scope only to learn how the scope is used, for example the callers, the store selectors and the client-core API modules.

### Write `docs/audit/messages-chat-list.md`
1. **Behaviour list.** Number every behaviour a user sees or relies on, for example:
   - row content: name, avatar, last message, time, unread count, muted, pinned, typing, draft;
   - ordering and folders;
   - contact requests (accept, decline, block);
   - the row menu (pin, mute, archive, mark read or unread, delete);
   - the new chat button and its menu;
   - on the server, the unread counts, read marks, deliveries and the delivered notice.

   For each, give where web does it (`file:line`), where the phone does it, and what the server guarantees. Mark platform-only behaviours as such.
2. **Twin logic.** Every piece that web and phone implement separately but that is the same rule (row derivation, ordering, filters, request rows, menu items and their conditions, the new chat menu). Give both locations and line counts.
3. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs. This includes the server: route bodies, payload copying, repeated access checks.
4. **Dead code:** exports, props, routes and branches nothing reaches (prove it with `git grep`).
5. **Lean target structure:**
   - the new files, each with its home: a shared chat-list view model in `client-core`; app markup and gestures; one server service per rule;
   - what each file owns, and a line budget;
   - the files to delete;
   - the total budget against today's 6,743. Aim for at least 40% fewer lines with every behaviour from part 1 kept.

   Be concrete: someone must be able to write the rewrite spec from this part alone.
6. **Risks:** behaviours that are easy to lose in a rewrite (above all unread counts and read marks, which are the message pipeline), and how the lead should check each one (web mock, the phone emulator, or live).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/messages-chat-list.md`
- `work/T-2231-audit-messages-chat-list.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all six parts.
- The target structure has budgets per file and a total.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/messages-chat-list.md` with all six parts: the numbered behaviour list
(49 behaviours, with web/phone/server locations), the twin-logic table (13 rules), slop by
every `docs/LEAN_CODE.md` rule, the dead-code list with `git grep` proof, the lean target
structure with a per-file budget and a total, and the risks with how to check each one. No
code was changed; the only other edit is this task file.

The target is **3,471 lines** against **6,710 measured today** (48.3% fewer). The task
estimate says 6,743; two files moved since then (`chat-folders/api.ts` is 110, not 142, and
`chat-prefs/api.ts` is 124, not 125), so the doc states the measured number and derives
the percentage from it.

### Files changed

- `docs/audit/messages-chat-list.md` (new, 506 lines)
- `work/T-2231-audit-messages-chat-list.md` (report and status)

### Commands run

- `pnpm install --frozen-lockfile`: done in 31.1s, no errors.
- `wc -l` over the 29 scope files: 6,710 total (per-file counts in the doc).
- `git grep -n` checks for `defaultGroupId`, `onSignOut`/`isServerOwner`,
  `onPref`/`openSwipeRef`, `visibleChats`, `requireChatReadAccess`,
  `ChatFolderRow`/`ChatPrefRow` and the mobile API wrappers: results in part 4 of the doc.
- No single test files were run because no source code changed.
- `pnpm gate` (repo root), summary lines:

```text
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (1.0s)
PASS  lint  (2.9s)
PASS  typecheck  (2.9s)
SKIP effect (no source files changed)
SKIP build @zilar/server (no server, package or manifest change)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Problems and deviations

- The scope count is 6,710, not the spec's 6,743, for the two file-count reasons above.
  The doc says so and uses `wc -l`.
- The audit found two unreachable user-facing paths rather than live behaviour: the web
  Sign out item and the phone swipe actions. The behaviour list documents the live paths
  and part 4 proves the dead ones; part 6 asks the lead to choose restore or delete before
  writing the rewrite spec. This does not block the audit.

### Open questions

- For the rewrite spec: should the web Sign out entry and the phone row swipes be restored
  from the shared actions, or deleted? Today neither is reachable from the chat list.

## Review (written by Claude)

Approved; clean (3 doc nits). The map is concrete: a behaviour list with web, phone and server `file:line` for each, 13 twin rules, and a lean target of 3,471 lines against today's 6,710 (−48%) with per-file budgets. The pipeline tests stay.

**Lead decisions on part 4 (dead code):**
- The phone row swipe actions and the web chat-list "Sign out" were both removed on purpose on 10-13: folder swipe (T-1310) took the gesture, and Sign out moved to Settings › Devices. So the rewrite deletes their leftovers.
- **Next:** rewrite specs from part 5, in steps (shared view model first, then web, phone and server).
