---
id: T-1511
title: "Web empty chats (approved canvas): an empty DM shows only the person's picture, name and @handle; an empty AI chat shows the AI's picture, name + AI badge, its model line and three suggestion chips that send"
status: merged
milestone: M5
branch: task/T-1511-web-empty-chats
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1511: Web empty chats

## Spec (written by Claude, do not edit)

### Why
Julio reviewed the empty chat canvas on 2026-10-15. He turned down a greeting sticker ("something simpler will be nice"), and the simpler version is approved. The boards and README are in `docs/design/mockups/empty-chat/`; read `README.md`, `WebDm.dc.html` and `Main.dc.html`.
- **An empty DM:** only the person's 72 px picture, the name (18 px, 600) and the `@handle` (mono 12 px, muted), centred. Nothing to tap.
- **A new AI chat:**
  - the AI's 72 px picture;
  - the name with the "AI" badge;
  - the mono model line (`deepseek-chat · DeepSeek`);
  - three suggestion chips (36 px high, round, the `key-icon` look) that send their text.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/MessageList.tsx` (392 lines, near the limit):**
  - with no items and history settled, it renders `<StateMessage kind="empty" title="No messages yet" />` on the chat background (`:324-335`);
  - the component has `chat: ChatSummary` (`:43`) and `backgroundStyle` (`:72`).
- **The chat summary:** `chat.isAI` marks an AI chat (as in `apps/web/src/components/ChatHeader.tsx:152`, which renders `AiBadge`); `chat.kind` is the chat kind.
- **A DM's handle:**
  - `dmContactFor(chat, contacts)` from `apps/web/src/lib/contacts.ts:10`, with `useChatSelector((s) => s.contacts)`;
  - `ContactPanel.tsx:78-98` also falls back to the by-handle profile; the contact's handle is enough here, and with no handle the line is left out.
- **An AI's model:**
  - `apps/web/src/components/ais/AiPanel.tsx:76-90` finds the AI with `listAis()` and `item.jid === chat.id`;
  - the provider name comes from `listConnections()` plus `providerLabel` (`apps/web/src/routes/AisPage.tsx:276-290`, `providerNamesOf`);
  - `PublicAi.template` is `dev | marketing | fun | custom`.
  - Someone else's AI is not in `listAis()`: then leave out the model line.
- **Sending:** the composer sends plain text with `storeApi.getState().sendText(chatId, value, {})` (`apps/web/src/components/Composer.tsx:275`).
- **The kit:** `EntityAvatar`, `AiBadge` (`apps/web/src/components/AiBadge.tsx`), and the `key-icon` class.

### What to build
1. **New `apps/web/src/components/message/EmptyChat.tsx`:** `EmptyChat({ chat })`, centred in the chat background with a 16 px gap.
   - **DM** (not `isAI`, kind is a DM): a 72 px `EntityAvatar`, the name, and `@handle` in mono when the contact has one.
   - **AI chat** (`isAI`):
     - the 72 px avatar (`ai`), the name and `AiBadge`;
     - the mono line `<model> · <provider>`, read once with `useQuery` from `listAis()` (and `listConnections()` for the provider name), and left out while loading or when not found;
     - three chips in a centred wrapping row, max 520 px. Each is a `button` with the text, which calls `sendText(chat.id, text, {})`. The texts by template:
       - `dev`: "What can you do?", "Review my last change", "Plan a small feature";
       - `marketing`: "What can you do?", "Write a launch post", "Improve this headline";
       - anything else, or the AI not found: "What can you do?", "Summarize a link for me", "Help me plan my day".
   - **Any other chat** (groups, topics, channels): keep today's `StateMessage` "No messages yet".
2. **`MessageList.tsx`:** the empty branch renders `<EmptyChat chat={chat} />` inside the same background `div`. The file must not grow.

### Not in scope
- the mobile app (its own task);
- the composer;
- groups' empty state.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/components/message/EmptyChat.tsx` (new)
- `apps/web/src/components/MessageList.tsx`
- `work/T-1511-web-empty-chats.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In `?mock=1`, an empty DM shows only the picture, name and @handle.
- An empty AI chat shows the picture, name, AI badge, model line and three chips; a chip sends its text.
- No horizontal scroll at 390 px.

---

## Report (written by the worker when done)

### What I did

**New `apps/web/src/components/message/EmptyChat.tsx`** (`EmptyChat({ chat })`):
- **DM** (`kind === 'dm'`, not `isAI`): a centred 72 px `EntityAvatar`, the name (18 px, 600) and `@handle` in mono 12 px muted, from `dmContactFor(chat, contacts)?.handle`. When the contact has no handle the line is left out (per spec line 44 and the fact bullet).
- **AI chat** (`isAI`): the 72 px avatar with `ai`, the name with `AiBadge`, the mono model line, and three chips in a centred wrapping row (`max-w-[520px]`, 36 px high, `key-icon`, round). Each chip is a `button` that calls `storeApi.getState().sendText(chat.id, text, {})`. Texts by template: `dev` and `marketing` per the spec, anything else or an unknown AI gets the default three.
- The model line is one `useQuery` over `listAis()` + `listConnections()` (provider via `providerLabel`), keyed by `chat.id`/`chat.isAI`; it renders only when the AI is found (someone else's AI is not in the list) and is omitted while loading. A failed `listConnections()` read just drops the provider (`<model>` alone).
- **Any other chat** (groups, topics, channels): the existing `<StateMessage kind="empty" title="No messages yet" />`.

**`apps/web/src/components/MessageList.tsx`:** the empty branch now renders `<EmptyChat chat={chat} />` inside the same `chat-background` div. The only other change is one new import line; no logic was added there. The file is 393 lines (was 392), still inside the gate's 400-line limit.

Files changed: `apps/web/src/components/message/EmptyChat.tsx` (new), `apps/web/src/components/MessageList.tsx`, `work/T-1511-web-empty-chats.md`.

### Checks run

- `pnpm exec prettier --write` on both source files: `unchanged`.
- `pnpm gate` (ends `GATE PASS`):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.2s)
PASS  typecheck  (4.1s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: 7 file(s) outside the Allowed files:
  docs/design/mockups/empty-chat/Main.dc.html
  docs/design/mockups/empty-chat/PhoneAi.dc.html
  docs/design/mockups/empty-chat/PhoneDm.dc.html
  docs/design/mockups/empty-chat/PhoneFiles.dc.html
  docs/design/mockups/empty-chat/README.md
  docs/design/mockups/empty-chat/WebDm.dc.html
  docs/design/mockups/empty-chat/WebFiles.dc.html
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single tests: none. The change is UI only (AGENTS.md: UI code gets no tests), and the gate skipped `@zilar/web` with "no nearby test files".

### Notes for the lead

- **The 7 "outside the Allowed files" paths are not mine.** They are the design mockups the lead committed on this branch in `699780122` ("T-1511: approved empty chat boards"), before this work. My own edits are exactly the three Allowed files.
- **`@handle` in `?mock=1`: the acceptance and the mock data disagree.** The shared mock backend's `contacts` payload omits `handle` (`packages/mock-backend/src/domains/contacts/routes.ts` `contactsOf`, and `lib/contacts.ts` documents this), so with the spec's rule ("`@handle` ... when the contact has one", "with no handle the line is left out") an empty DM in `?mock=1` shows the picture and name but **no `@handle`**. Making the mock show one would need the mock seed, which is outside this task's Allowed files. I followed the build rule as written; flagging so you can decide whether the acceptance line, the rule, or the mock seed should change.
- **`MessageList.tsx` grew by exactly one line** (the `EmptyChat` import). The empty-chat logic lives in `EmptyChat.tsx`, per the spec; if you want the file strictly not to grow, the only remaining slack would be to restructure the empty branch's wrapper div, which I did not do to avoid a layout change.
- The model line drops the provider only when `listConnections()` fails or the AI's connection is missing; it is omitted entirely while loading or when the jid is not in `listAis()`.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits and 1 follow-up, for head `9691f9cfb`.
- **The lead read `EmptyChat.tsx`:**
  - a DM shows a 72 px picture, the name and the mono `@handle` when the contact has one;
  - an AI chat shows the picture, name, `AiBadge`, the `model · provider` line from `listAis` plus `listConnections`, and three chips by template that call `sendText`;
  - every other chat keeps "No messages yet".
- **Not checked on screen:** no mock chat is empty, and the mock contacts carry no handle, so the mock DM would show no `@handle` (the follow-up). In production, contacts have handles.
- **Nits accepted:**
  - `MessageList.tsx` grew one line, to 393;
  - the chips show the default texts while the AI list loads.
- **Carried:** the empty chat and several-files boards and README in `docs/design/mockups/empty-chat/`.

