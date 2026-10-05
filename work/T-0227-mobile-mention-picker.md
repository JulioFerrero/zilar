---
id: T-0227
title: "Mobile: @mention picker in the group composer, and mentions sent with the message"
status: planned
milestone: M5
branch: task/T-0227-mobile-mention-picker
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.6 day
---

# T-0227: @mention picker on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". `docs/audit/mobile-parity-gaps.md` 7.2 "T-0190a" (lines 1083-1116). On web, typing `@` in a group composer opens a member picker and the message carries XEP-0372 mention references; the phone has none of it (no picker, `sendText` sends no mentions, group members have no handle). Showing received mentions highlighted in the bubble is a separate later task.

### What the person sees
In a group chat (not a DM), typing `@` (at the start or after a space) opens a small list right above the composer: up to `MENTION_MAX_ROWS` rows (same number as web) of group members and the group's AIs that match the text after `@` (name or handle), never yourself. Each row: avatar (28 px, `Avatar` from `apps/mobile/src/components/chat/avatar.tsx`), the name, and `@handle` muted when the person has one; an AI gets the same small AI badge the app uses elsewhere (or the word `AI` muted if there is none). Tapping a row replaces the `@query` with `@handle ` (or `@Name ` when there is no handle, exactly as `insertMention` does), closes the list and puts the caret after it. The list closes when the query no longer matches anyone, on send, and on a chat switch. Deleting one character inside or right after a mention removes the whole mention token. Sending carries the mentions; the message text is unchanged. The phone has no hardware-key navigation (no arrow keys): rows are tapped.

### Verified facts (do not re-derive)
- Pure helpers in `packages/chat-core/src/mentions.ts`: `findMentionQuery(text, caret)` (line 21), `insertMention(text, caret, member)` (line 50, returns `{ text, caret, mention }`), `rebaseMentions(old, next, mentions)` (line 97), `filterMentionMembers(members, query)` (line 174), `isMentionOfMe(jid, meJid)` (line 207), `mentionsForTrimmedText(text, trimmed, mentions)` (line 218). `MentionMember { jid; name; handle? }` in `packages/chat-core/src/types.ts` line 39; `UiMention` is the mention type the web composer tracks.
- Web reference: `apps/web/src/components/Composer.tsx`: members list (lines 256-263: groups only, `store.groupMembers(chatId)` minus me, `filterMentionMembers(...).slice(0, MENTION_MAX_ROWS)`), `onChange` (lines 301-305: `rebaseMentions`, `findMentionQuery`), `pickMention` (lines 410-424), send with mentions (lines 493-500), chat switch reset (lines 238-246), backspace removes a whole mention (lines 584-598). `apps/web/src/components/MentionPicker.tsx` (67 lines) is the row layout.
- Web store: `SendTextOptions.mentions?: UiMention[]` (`apps/web/src/store/store.ts` line 90-93); real `sendText` (`apps/web/src/store/realStore.ts` lines 3926-3980) computes `mentionsForTrimmedText(text, trimmed, options?.mentions ?? [])`, puts them on the optimistic message and passes `mentions: [{ jid, begin, end }]` to `core.sendMessage(chatId, kind, trimmed, { replyTo?, mentions? })`. Web builds the member map in `applyGroupDetail` (realStore.ts lines 2208-2224): members `{ jid: localpart@domain, name, handle? }` plus AIs `{ jid: ai.jid, name }`.
- Mobile store: `SendTextOptions = { replyTo?: ReplyRef }` (`apps/mobile/src/store/types.ts` line 37); `sendText` (`apps/mobile/src/store/real-store.ts` line 3084) calls `core.sendMessage(chatId, coreKind(chat), trimmed, replyTo ? { replyTo } : undefined)` (lines 3116-3121); an internal `groupMembers` map (line 456) of localpart → name, filled by `rememberMembers` (lines 1922-1928) from the group detail; not exposed on the store. The mock store is `apps/mobile/src/store/chat-store.ts`.
- Mobile group detail: `GroupMember { userId, name, role, roles }` (`apps/mobile/src/lib/chat-api.ts` lines 47-54, parsed at lines 236-253; no `handle`), `GroupAi { aiId, jid, name, ownerId }` (lines 72-77). The server sends `handle` on members (web reads it since T-0169).
- Mobile composer: `apps/mobile/src/components/chat/composer.tsx` (580 lines): `onSend: (text: string) => void` (line 116), `handleChange` (line 457), send (lines 383-396), the `TextInput` with `onSelectionChange` tracking the caret (lines 491-508). The chat screen `apps/mobile/src/app/chat/[id].tsx` renders `<Composer onSend={(text) => sendText(chat.id, text, ...)} />` at lines 523, 671, 701 and 906.

### What to build
1. `chat-api.ts`: parse an optional `handle` (string or null) on group members into `GroupMember.handle?: string`.
2. Store: `SendTextOptions.mentions?: UiMention[]` in `types.ts`; a store method `groupMembers(chatId): MentionMember[]` (members with `jid = localpart@domain`, name, handle; plus the group's AIs), built like web's `applyGroupDetail` (keep the existing name map working for sender names); `sendText` computes `mentionsForTrimmedText`, sets them on the optimistic message and passes `mentions: [{ jid, begin, end }]` to `core.sendMessage` (check `core.sendMessage`'s options type in `packages/chat-core` and follow web). The mock store implements `groupMembers` from its mock groups and accepts `mentions`.
3. New `apps/mobile/src/components/chat/mention-picker.tsx`: `MentionPicker({ members, onSelect })` with the rows above (`accessibilityRole="button"`, label `Mention <name>` or `Mention <name> @<handle>`), positioned above the composer input.
4. `composer.tsx`: new optional props `mentionMembers?: MentionMember[]` (picker only when given) and `onSend: (text: string, mentions?: UiMention[]) => void`; track mentions and the picker like web (change, pick, backspace, send, chat switch, edit mode keeps today's behaviour without the picker).
5. `chat/[id].tsx`: for group chats pass `mentionMembers={groupMembers(chat.id)}` (minus me via `isMentionOfMe`) and forward `mentions` into `sendText(chat.id, text, { replyTo?, mentions? })` at the composer call sites.
6. Tests (Vitest): `apps/mobile/src/components/chat/mention-picker.test.tsx` (rows, handle shown, AI marker, label, onSelect); composer logic test (`apps/mobile/src/components/chat/composer.test.tsx` if it exists, else extract the pure mention-state helpers into `apps/mobile/src/components/chat/composer-mentions.ts` with a `composer-mentions.test.ts`: open on `@`, filter, pick inserts `@handle `, backspace removes the token, send returns the mentions, DM gets no picker); `apps/mobile/src/lib/chat-api.test.ts` (handle parsed, null handle ignored); a store test that `sendText` with mentions passes `[{ jid, begin, end }]` to the core fake and that `groupMembers` returns members with handles and AIs (follow the existing `apps/mobile/src/store/real-store*.test.ts` pattern).

### Read first
`AGENTS.md`, `packages/chat-core/src/mentions.ts`, `apps/web/src/components/Composer.tsx` (lines 230-310, 400-500, 575-600), `apps/web/src/components/MentionPicker.tsx`, `apps/web/src/store/realStore.ts` (lines 2205-2225 and 3925-3980), `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/store/real-store.ts` (lines 450-460, 1915-1945, 3080-3130), `apps/mobile/src/lib/chat-api.ts` (lines 40-80, 225-260).

### Allowed files
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/chat-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/real-store.mentions.test.ts` (new), `apps/mobile/src/components/chat/mention-picker.tsx` (new), `apps/mobile/src/components/chat/mention-picker.test.tsx` (new), `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-mentions.ts` (new, optional), `apps/mobile/src/components/chat/composer-mentions.test.ts` (new, optional), `apps/mobile/src/app/chat/[id].tsx`, `work/T-0227-mobile-mention-picker.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot mention-picker composer-mentions chat-api real-store.mentions
pnpm gate
```

### Acceptance
- In a group, `@` opens the picker with matching members and AIs (never me); a tap inserts `@handle ` / `@Name `; the sent message carries XEP-0372 mentions with the right offsets; DMs show no picker.
- No server, web or package change (chat-core untouched); no new dependency; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Highlighting received mentions in bubbles (next task), mentions in edits, topic composers if they use a different component.

---

## Report (written by the worker when done)

## Review (written by Claude)
