---
id: T-0249
title: "Web: a blocked person's message never shows as a chat list preview; one shared isBlockedSender helper; two stale comments"
status: merged
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

### What I did
- `apps/web/src/lib/blockedJids.ts`: renamed `bareJid` to `localpartOf` (kept private), added exported `isBlockedSender(senderId, blocked)` (lowercased localpart match), and fixed both doc comments to say "localparts".
- `apps/web/src/lib/preview-message.ts` (new): pure `previewMessage(chat, messages, blocked, meId)`. DMs and AI chats return `chat.lastMessage` unchanged; in a group/channel a blocked last sender falls back to the newest loaded message from anyone else (my own always counts), or `undefined` when none is loaded.
- `apps/web/src/components/MessageList.tsx`: replaced the inline localpart filter with `isBlockedSender`; behaviour unchanged.
- `apps/web/src/components/ChatListItem.tsx` and `TopicRow.tsx`: preview text/prefix now come from `previewMessage`. `own` (read ticks) and the row timestamp still follow `lastMessage`, per the spec which only covers preview text.
- Comments: `apps/server/src/blocks/routes.ts` now lists `jid` (null when no XMPP account); `packages/ui-tokens/src/index.ts` says the dot grid is on both apps (decided 2026-10-05) and these entries are real differences only.
- Tests: `isBlockedSender` case/domain cases added to `blockedJids.test.ts`; new `preview-message.test.ts` (blocked last → previous visible, own kept, nothing loaded → undefined, DM/AI untouched); a new `ChatListItem` render suite with a blocked last sender.

### Files changed (all inside Allowed files)
`apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/blockedJids.test.ts`, `apps/web/src/lib/preview-message.ts` (new), `apps/web/src/lib/preview-message.test.ts` (new), `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/ChatListItem.test.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/server/src/blocks/routes.ts`, `packages/ui-tokens/src/index.ts`, `work/T-0249-web-blocked-previews.md`.

### Commands and results
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/blockedJids.test.ts src/lib/preview-message.test.ts src/components/ChatListItem.test.tsx src/components/MessageList.test.tsx` → `Test Files 4 passed (4)`, `Tests 43 passed (43)`.
- `pnpm gate` (first run) → `FAIL format`, only `apps/web/src/components/MessageList.tsx` (`GATE FAIL`). Reformatted that one block and re-ran.
- `pnpm gate` (final) summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (18.3s)
  PASS  lint  (1.1s)
  PASS  typecheck  (8.8s)
  PASS  tests @zilar/server  (361.3s)
  PASS  tests @zilar/ui-tokens  (0.8s)
  PASS  tests @zilar/web  (45.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- The first gate run failed format on `MessageList.tsx`; fixed and the final run is green.
- Minor judgment call (flagged for review): when the fallback preview is an older visible message, the row's timestamp and read ticks still reflect `lastMessage`, not the fallback, because the spec only changes the preview text.

### Security checklist
- No secrets touched or logged; changes are web rendering, one server comment and one token comment.
- No new routes, deletes, updates, caps or audit entries; nothing to newly rate-limit.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (1 test nit).
- I read the diffs of `ChatListItem`, `TopicRow` and `blockedJids`:
  - both rows use `previewMessage`;
  - `isBlockedSender` is shared with `MessageList`;
  - the comments now say "localparts".
- Accepted: the row time and ticks still follow `chat.lastMessage`, which matches the spec and leaks no content.
