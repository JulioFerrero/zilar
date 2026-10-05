---
id: T-0249
title: "Web: a blocked person's message never shows as a chat list preview; one shared isBlockedSender helper; two stale comments"
status: planned
milestone: M5
branch: task/T-0249-web-blocked-previews
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0239]
estimate: 0.3 day
---

# T-0249: Blocked people in chat list previews (web)

## Spec (written by Claude, do not edit)

### Why
Follow-up of T-0239. On the web, group and channel messages from people I blocked are hidden in the open chat, but the chat list and topic rows still preview their last message. This task also clears two stale comments that the reviews flagged.

### Verified facts (do not re-derive)
- `apps/web/src/lib/blockedJids.ts`:
  - the set holds lowercased **localparts**: `bareJid` (around line 15) returns the part before `@`, despite its name;
  - `load()` adds `bareJid(person.jid)` (line 30);
  - `useBlockedJids()` is at line 62.
  - `apps/web/src/components/MessageList.tsx` lines 36-49 repeat the localpart logic inline to hide blocked senders in groups (`chat.kind === 'group' && chat.isAI !== true`) and never hide my own messages.
- Previews:
  - `apps/web/src/components/ChatListItem.tsx` lines 30-40 (`chat.lastMessage`, `previewPrefix`, `previewBody`, `own`);
  - `apps/web/src/components/TopicRow.tsx` `rowPreview` (lines 15-25) and lines 39-41.
  - `ChatSummary.lastMessage?: UiMessage` carries `senderId` (`packages/chat-core/src/types.ts` around line 149).
  - Messages in memory: `store.messages(chatId)` (used by `MessageList.tsx` line 28).
- Stale comments:
  - `apps/server/src/blocks/routes.ts` lines 74-75 document the list without `jid`;
  - `packages/ui-tokens/src/index.ts` line 108 still says "Julio decides the dot-grid question later" (it was decided on 2026-10-05: dot grid on both).

### What to build
1. `blockedJids.ts`:
   - rename `bareJid` to `localpartOf`;
   - export `isBlockedSender(senderId: string, blocked: ReadonlySet<string>): boolean` (lowercased localpart match);
   - fix the doc comment to say "localparts";
   - `MessageList.tsx` uses the helper instead of the inline logic. Behaviour is unchanged.
2. **Previews:** in a group or channel row (`ChatListItem`) and in topic rows (`TopicRow`), when `lastMessage` is from a blocked sender:
   - preview the newest message in `store.messages(chat.id)` that is not from a blocked sender, if one is loaded;
   - otherwise show no preview text (empty body, no prefix).
   - My own messages are never hidden. DMs and AI chats are unchanged.
   Put the choice in one pure function, `previewMessage(chat, messages, blocked, meId)`, in `blockedJids.ts` or a small new `apps/web/src/lib/preview-message.ts`.
3. **Comments:** `routes.ts` lines 74-75 list `jid` (null when there is no XMPP account). `ui-tokens` line 108 says the dot grid is on both apps and these entries are real differences only.
4. **Tests:**
   - `isBlockedSender` (case and domain differences);
   - `previewMessage` (blocked last → previous visible; nothing loaded → undefined; own message kept; DM untouched);
   - a `ChatListItem` render test with a blocked last sender showing no blocked text.
   - The existing `MessageList` tests stay green.

### Read first
`AGENTS.md`, `apps/web/src/lib/blockedJids.ts`, `apps/web/src/components/MessageList.tsx` (lines 1-60), `apps/web/src/components/ChatListItem.tsx` (lines 1-60), `apps/web/src/components/TopicRow.tsx` (lines 1-60).

### Allowed files
`apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/blockedJids.test.ts`, `apps/web/src/lib/preview-message.ts` (new), `apps/web/src/lib/preview-message.test.ts` (new), `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/ChatListItem.test.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/server/src/blocks/routes.ts`, `packages/ui-tokens/src/index.ts`, `work/T-0249-web-blocked-previews.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/blockedJids.test.ts src/lib/preview-message.test.ts src/components/ChatListItem.test.tsx src/components/MessageList.test.tsx
pnpm gate
```

### Acceptance
- No chat or topic row previews a blocked person's message. Open chats behave as after T-0239.
- The server change is the comment only. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Unread counts from blocked people (they come from the server read state; a later server task), mobile, mentions and notifications.

---

## Report (written by the worker when done)

## Review (written by Claude)
