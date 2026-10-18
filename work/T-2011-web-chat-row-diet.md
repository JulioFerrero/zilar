---
id: T-2011
title: "Chat perf W5 (web): the message menu's store reads run only while it is open, avatars read one primitive instead of whole contact/chat arrays, and the pin lookup is one id map per list — so scrolling a long chat while an AI streams commits only the draft row"
status: merged
milestone: M5
branch: task/T-2011-web-chat-row-diet
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2011: Web chat row diet (perf W5)

## Spec (written by Claude, do not edit)

### Why
The lead's performance audit (T-1997, `docs/audit/chat-scroll-perf.md` section 7 and W5) found that every web message row runs store selectors on every store change:
- a whole menu's worth;
- two whole-array avatar reads;
- a pin search.

While an AI reply streams, the store changes many times a second, so every mounted row runs all of them each time. The shared parts are fixed in client-core by T-2008. This task fixes the web-only parts. The UI has no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18; paths under `apps/web/src/`)
- **Two menus per bubble.** `components/MessageBubble.tsx` (399 lines, at the limit) mounts `<MessageMenu>` twice: at `:263` for the big-emoji layout and at `:374`. Both are always mounted, with `open={menuOpen && ...}`.
- **Per-row reads in the bubble** (`:84-89`):
  - `useChatSelector((s) => s.mediaTrustedHosts)`;
  - `s.canPin(chatId)`;
  - `s.pinFor(chatId, message.id)`;
  - `s.groupInfos[chat.id]?.members`.
- **Menu reads.** `components/message/MessageMenu.tsx` (294 lines) renders its popup only inside `{open && (` (`:168`). Its hooks still run while closed:
  - `s.chats.find((entry) => entry.id === chatId)` (`:132`);
  - `s.currentUserId` (`:133`).
  
  It also holds `confirmOpen` (`:116`) and `pickerOpen` (`:119`) state for its delete dialog and emoji picker. Those must stay mounted while they are open, and opening the picker closes the menu (comment `:117-118`).
- **Avatar reads.** `components/EntityAvatar.tsx` (74 lines) subscribes to the whole `s.contacts` and `s.chats` arrays (`:38-39`), then does `chats.find` or `contacts.find` for one avatar URL (`:49-57`).
- **Pin search.** In `store/realStore.ts`, `pinFor` runs `(get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId)` (`:105-106`).
- **The list.** `components/MessageList.tsx` (250 lines) renders `<MessageListRow>` (`:214`).
- **The row.** `components/MessageListRow.tsx` (125 lines) renders `<MessageBubble>` (`:86`) and passes a `Set` of selected ids (`:96`).

### Steps
1. **Menu reads only while open.** Mount the menu's store-reading body only while the menu, its delete confirm or its emoji picker is open.
   - Suggested approach: lift `confirmOpen` and `pickerOpen` into a small hook or state in the bubble. Alternatively, split `MessageMenu` into a thin always-mounted shell (state only, no selectors) and a `MessageMenuBody` that holds the selectors.
   - Mount only one `MessageMenu` per bubble, not two. Keep both layouts' positions.
2. **Avatars.** `EntityAvatar` selects only the primitive it needs: `s.chats.find(...)?.avatarUrl` or `s.contacts.find(...)?.avatarUrl`. Never select the whole array.
3. **Pins once per list.** `MessageList` selects `s.pinsByChat[chatId]` once and builds a `Map` from message id to pin id. `MessageListRow` passes each row its `pinId`. The bubble drops its `pinFor` selector.
4. **`MessageBubble.tsx` must end smaller than 399 lines**: move code out, never add net lines.
5. **Keep behaviour.** These must all work exactly as before:
   - the "…" button, right-click at the pointer and big-emoji placement;
   - Pin/Unpin, the pinned badge, Delete confirm, the emoji picker from the + key, Forward, Copy and Edit;
   - selection mode.
6. **No tests (UI).** Every file stays at or under 400 lines.

### Allowed files
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/message/MessageMenu.tsx`
- `apps/web/src/components/message/MessageMenuBody.tsx`
- `apps/web/src/components/message/use-message-menu.ts`
- `apps/web/src/components/EntityAvatar.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageListRow.tsx`
- `work/T-2011-web-chat-row-diet.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- In the web mock, the lead checks each menu path in step 5.
- With React Profiler, the lead checks that only the draft row commits while an AI reply streams.

---

## Report (written by the worker when done)

### What I did

- **Menu reads only while open.** Split `message/MessageMenu.tsx` into:
  - `MessageMenu` — the always-mounted shell. It only holds `confirmOpen` /
    `pickerOpen` (now in `message/use-message-menu.ts`) and returns `null`
    unless the menu, the delete confirm or the emoji picker is open.
  - `MessageMenuBody` (new `message/MessageMenuBody.tsx`) — holds the
    `s.chats.find(...)` / `s.currentUserId` selectors, `useAlbumMembers`, the
    actions menu, the three delete confirms and the emoji picker. It mounts
    only while one of those is open, so a closed menu runs no store reads.
  - `MessageActionsButton` stays exported from `MessageMenu.tsx` unchanged.
- **One menu element per bubble.** `MessageBubble.tsx` no longer repeats the
  ~19-line menu JSX in the sticker and regular branches; both branches render
  one shared `messageMenu` element (the branches were already a ternary, so
  only one was ever mounted at a time). The sticker branch keeps its
  `canCopy={false}`, `canEdit={false}` and `message.failed !== true` open
  guard; placement inside the same containers is unchanged.
- **Pin lookup once per list.** `MessageList.tsx` subscribes once to
  `s.pinsByChat[chatId]`, builds a `messageId -> pinId` `Map` with `useMemo`,
  and passes `pinId` to each row. `MessageListRow` forwards it to the bubble.
  `MessageBubble` dropped its `s.pinFor(chatId, message.id)` selector and the
  `pin` object; `MessageMenu` receives `pinId` as before.
- **Avatars read one primitive.** `EntityAvatar.tsx` now selects only
  `s.chats.find(id)?.avatarUrl` or `s.contacts.find(userId)?.avatarUrl` for the
  id it is given, instead of subscribing to the whole `chats` / `contacts`
  arrays and finding the row during render. Precedence is unchanged:
  `chat.avatarUrl` first, then the chat row; `person.avatarUrl`/`image` first,
  then the contact row.
- `MessageBubble.tsx` went from 399 to 391 lines; all other touched files are
  under 400 lines. No net new lines in the bubble; code moved out of it.

Files changed: `apps/web/src/components/MessageBubble.tsx`,
`apps/web/src/components/message/MessageMenu.tsx`,
`apps/web/src/components/message/MessageMenuBody.tsx` (new),
`apps/web/src/components/message/use-message-menu.ts` (new),
`apps/web/src/components/EntityAvatar.tsx`,
`apps/web/src/components/MessageList.tsx`,
`apps/web/src/components/MessageListRow.tsx`, this task file.

### Checks run

- `pnpm install`: success (`Done in 18.2s`).
- Single test files: none — this is UI-only, and the gate reports
  `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm gate` (repo root), exit 0:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (3.3s)
  PASS  format  (1.5s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.3s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The spec says both menus are always mounted; in fact the sticker and regular
  menus sit in the two arms of the `sticker !== undefined` ternary, so each
  bubble mounted one at a time. There is now a single shared element in both
  arms, and the shell renders nothing while closed.
- The `MessageMenu` shell returns `null` when idle, so `confirmOpen` and
  `pickerOpen` still survive the menu closing (the + key path and Delete focus
  restore keep working), but the picker's `Dialog` and the confirms now unmount
  as soon as they close rather than staying mounted closed.
- No behavior changes intended beyond the reads: menu open paths, big-emoji
  placement, right-click point, Pin/Unpin badge, Delete confirms, picker,
  Forward/Copy/Edit and selection mode all use the same props and callbacks as
  before. I did not run the web app or the React Profiler; that is the lead's
  check.

### Round (fix round 1)

- **Fixed finding 1 (must-fix): sticker bubbles mounted the menu twice.**
  `MessageBubble.tsx:384` rendered the shared `messageMenu` outside the
  sticker/regular ternary while `:291` rendered it again inside the sticker
  branch. The outer render is now gated with
  `{sticker === undefined ? messageMenu : null}`, so a sticker bubble mounts
  one menu, still anchored in its sticker `relative` div, and regular and
  big-emoji bubbles keep their original outer placement. Commit
  `636e1e712`; the file is still 391 lines.
- **Finding 2 (nit) left untouched:** it is in `MessageMenu.tsx`, which this
  fix does not change.
- **Tests:** none added. The spec says UI gets no tests (step 6), and the
  finding names no test; the gate reports `SKIP tests @zilar/web (no nearby
  test files)`.
- **Gate:** `pnpm gate` exit 0 —
  ```
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

Approved after 1 auto round; the pre-review was clean.
- **The change:**
  - the menu's store reads now live in `MessageMenuBody`, which mounts only while the menu, its delete confirm or its picker is open;
  - there is one menu per bubble;
  - `EntityAvatar` selects primitives;
  - pins are one map per list;
  - `MessageBubble.tsx` went from 399 to 391 lines.
- **Lead check in the web mock** (Playwright, chat with Ana, no page errors):
  - the "…" button opens the menu;
  - right-click opens it at the pointer;
  - Pin shows the pinned bar, and the menu then offers Unpin;
  - "More reactions" opens the emoji picker;
  - Delete opens its confirm.
- **Not measured:** React Profiler commits, which were left for the next long-chat measurement.
