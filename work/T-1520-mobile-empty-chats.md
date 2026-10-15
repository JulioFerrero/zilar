---
id: T-1520
title: "Phone empty chats (approved canvas, twin of T-1511): an empty DM shows the picture, name and @handle; an empty AI chat shows the picture, name, model line and three chips that send. The chip texts move to chat-core; the shared mock gets contact handles and two empty chats"
status: merged
milestone: M5
branch: task/T-1520-mobile-empty-chats
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1520: Phone empty chats

## Spec (written by Claude, do not edit)

### Why
Julio approved the empty chat design on 2026-10-15. Read `docs/design/mockups/empty-chat/README.md`, `PhoneAi.dc.html` and `PhoneDm.dc.html`. Web shipped as T-1511 (`apps/web/src/components/message/EmptyChat.tsx`, the reference); this is the phone twin.

The shared mock had no empty chat and no contact handles, so neither app could show these screens in mock mode. This task adds both.

### Facts (the lead read them on main, 2026-10-15)
- **The phone's empty state:** `apps/mobile/src/components/chat/message-list.tsx` (367 lines) renders `<StateMessage kind="empty" icon={MessageSquare} title="No messages yet" hint="Send a message to start the conversation." />` when the list is empty (`:303-311`). `chat: ChatSummary` is a prop (`:26`).
- **Web's `EmptyChat.tsx` (123 lines):**
  - the chip texts are `SUGGESTIONS` and `DEFAULT_SUGGESTIONS` (`:19-29`);
  - the AI's model line is `model · provider`, from `listAis()` plus `listConnections()`, with the provider named by `providerLabel` (exported by `@zilar/chat-core`, `packages/chat-core/src/ai-providers.ts:53`); without the connection it is just `model`;
  - a chip calls `sendText`.
- **The phone's helpers:**
  - `useAisApi()` (`apps/mobile/src/components/ais/use-ais-api.ts:56`): `api.listAis()`, where `PublicAi` has `jid`, `template`, `model` and `providerConnectionId`;
  - `useConnectionsApi()` (`apps/mobile/src/components/connections/use-connections-api.ts:55`): `api.listConnections()`;
  - the store's `sendText(chatId, text)` (`apps/mobile/src/components/chat/chat-composer-dock.tsx:47`, `:114`);
  - the DM handle is `dmHandleFor(chat, contacts)`, a private function in `apps/mobile/src/components/chat/chat-header.tsx:31-41`.
- **The shared mock:**
  - `packages/mock-backend/src/data/people.ts:5-29`: `MockPerson` has no handle;
  - `packages/mock-backend/src/domains/contacts/routes.ts:37-45`: `contactsOf` maps `userId`, `name` and `jid` only;
  - the DM rows are in `packages/mock-backend/src/domains/chats/seed.ts` (`:14`, `:48-49`, `:70-71`);
  - the thread seeds are keyed by chat JID in `packages/mock-backend/src/domains/messages/threads/index.ts:19-32`. Marco (`u-marco`) and QA-1 (`ai-qa-1`) have no chat and no thread.

### Steps
1. **New `packages/chat-core/src/ai-suggestions.ts`** (export it from `packages/chat-core/src/index.ts`): `aiSuggestions(template: string): readonly string[]`, with web's two lists moved here unchanged. Web's `EmptyChat.tsx` imports it instead of its own constants.
2. **The shared mock:**
   - `people.ts`: `MockPerson` gains `handle?: string`, and every human gets one (`ana`, `luis`, `marta`, `marco`, `sofia`);
   - `contacts/routes.ts`: `contactsOf` adds `handle` when set;
   - `chats/seed.ts`: add two DM rows with no thread: `{ kind: 'dm', chatJid: 'marco@zilar.test', title: 'Marco', userId: 'u-marco', isAi: false }` and `{ kind: 'dm', chatJid: 'ai-qa-1@zilar.test', title: 'QA-1', isAi: true }`;
   - update any mock-backend test that counts chats or contacts.
3. **`chat-header.tsx`:** export `dmHandleFor`.
4. **New `apps/mobile/src/components/chat/empty-chat.tsx`**, after the boards; the content is centred with `gap` 14:
   - **An AI chat:**
     - the 80 px `EntityAvatar` (`ai`);
     - the name (20 px, 600);
     - the mono model line (12 px, muted), left out until known;
     - then, `gap` 8 and 10 px above, the three chips from `aiSuggestions(template)` (default list while loading). Each chip is a 44 px pill (`Button variant="outline"`, `rounded-full px-4`, 15 px, 500) that calls `sendText(chat.id, text)`.
   - **A DM (not AI):** the 80 px picture, the name (20 px, 600) and `@handle` in mono 12 muted when `dmHandleFor` knows one. Nothing to tap.
   - **Any other chat:** keep today's "No messages yet" `StateMessage`.
5. **`message-list.tsx`:** the empty branch renders `<EmptyChat chat={chat} />` in place of the `StateMessage`. The file stays under 400 lines.

### Not in scope
- several files at once (a later task);
- the server.

### Tests
None new (UI). Keep the mock-backend tests passing.

### Allowed files
- `packages/chat-core/src/ai-suggestions.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/EmptyChat.tsx`
- `packages/mock-backend/src/data/people.ts`
- `packages/mock-backend/src/domains/contacts/routes.ts`
- `packages/mock-backend/src/domains/chats/seed.ts`
- any `packages/mock-backend/src/**/*.test.ts` that counts chats or contacts
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/empty-chat.tsx` (new)
- `apps/mobile/src/components/chat/message-list.tsx`
- `work/T-1520-mobile-empty-chats.md`

### Checks
```bash
pnpm --filter @zilar/mock-backend exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- **Phone mock:**
  - `/chat/marco@zilar.test` shows Marco's picture, "Marco" and `@marco`;
  - `/chat/ai-qa-1@zilar.test` shows QA-1's picture, name, model line and three chips, and a chip sends.
- **Web mock:** the same two chats show web's empty states.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

1. **`packages/chat-core/src/ai-suggestions.ts` (new):** `aiSuggestions(template: string): readonly string[]` with web's two lists moved here unchanged; exported from `packages/chat-core/src/index.ts` (`export * from './ai-suggestions';`).
2. **`apps/web/src/components/message/EmptyChat.tsx`:** dropped the local `SUGGESTIONS`/`DEFAULT_SUGGESTIONS` and imports `aiSuggestions` from `@zilar/chat-core`; the chip list is now `aiSuggestions(ai === null ? '' : ai.template)` (unknown/loading → default list), so web renders the same chips as before.
3. **Shared mock:**
   - `data/people.ts`: `MockPerson` gained `handle?: string`; the five humans (ana, luis, marta, marco, sofia) each carry their lowercase handle.
   - `domains/contacts/routes.ts`: `contactsOf` adds `handle` when the person has one.
   - `domains/chats/seed.ts`: added `{ kind: 'dm', chatJid: 'marco@zilar.test', title: 'Marco', userId: 'u-marco', isAi: false }` and `{ kind: 'dm', chatJid: 'ai-qa-1@zilar.test', title: 'QA-1', isAi: true }`, both with no thread.
   - No mock-backend test counts chats or contacts (only `groups/routes.test.ts` and `chats/routes.test.ts` exist, and neither asserts a total), so none needed updating.
4. **`apps/mobile/src/components/chat/chat-header.tsx`:** `dmHandleFor` is now exported (only change: added `export`).
5. **`apps/mobile/src/components/chat/empty-chat.tsx` (new):** the phone empty state, centred with `gap-3.5` (14 px). An AI chat renders the 80 px `EntityAvatar` (`ai`), the name (20 px/600), the mono model line (12 px muted, omitted until known) and three chips from `aiSuggestions(template)` (default list while loading); each chip is a 44 px (`h-11`) `Button variant="outline"` pill (`rounded-full px-4`, 15 px/500) calling `sendText(chat.id, text)`. A DM renders the 80 px picture, the name and `@handle` in mono 12 muted when `dmHandleFor` finds one, with nothing to tap. Any other chat keeps the "No messages yet" `StateMessage`. The AI info is read with mobile's `useQuery` over `useAisApi().listAis()` + `useConnectionsApi().listConnections()`, mirroring web's lookup and its `providerLabel` fallback.
6. **`apps/mobile/src/components/chat/message-list.tsx`:** the empty branch now returns `<EmptyChat chat={chat} />`; removed the now-unused `MessageSquare` and `StateMessage` imports. File is 357 lines (under 400).

Files changed (10): the two new files above plus `packages/chat-core/src/index.ts`, `apps/web/src/components/message/EmptyChat.tsx`, `packages/mock-backend/src/data/people.ts`, `packages/mock-backend/src/domains/contacts/routes.ts`, `packages/mock-backend/src/domains/chats/seed.ts`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `work/T-1520-mobile-empty-chats.md`.

### Checks run

- `pnpm install` — done, no error (`Done in 12.2s`).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot` — 2 files passed, 7 tests passed.
- `pnpm gate` (from repo root) — summary:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.7s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.3s)
  PASS  tests @zilar/mock-backend  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

No tests were added (UI-only change, per the task). I did not run the app on a device/emulator; the visual acceptance is for the lead's phone smoke / Julio's live check.

### Notes for the lead

- Followed the phone spec exactly: the empty state is centred inside `EmptyChat` (`gap-3.5`), and `message-list.tsx` returns `<EmptyChat chat={chat} />` in place of the previous wrapper + `StateMessage`. The "any other chat" branch reproduces the old `StateMessage` markup (with its `p-8` wrapper) inside `EmptyChat`.
- The AI body shows the name **without** the `AiBadge` (the phone mock and the task's element list omit it in the body; the badge lives in the header). Web's body still shows its badge, unchanged.
- `EmptyChat` still renders for any empty chat that is not a DM or AI (groups, topics, channels), so nothing regressed there.
- QA-1 exists in the mock AI seed (`template: 'dev'`, `model: 'gpt-4o'`, `conn-openai`), so `/chat/ai-qa-1@zilar.test` shows "gpt-4o · OpenAI" and the dev chips; Marco is a seed contact, so `/chat/marco@zilar.test` shows `@marco`.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 follow-up, for head `83bfbab49`.
- **Phone smoke (mock build, emulator):** both routes pass.
  - **Marco:** an empty DM with the 80 px picture, "Marco" and `@marco`; nothing else.
  - **QA-1:** the picture, "QA-1", `gpt-4o · OpenAI` in mono, and three pill chips.
- **Web on this branch (headless, mock):** the same two chats show web's empty states, and web now reads the chips from `aiSuggestions`. 0 page errors.
- **Follow-up for AI work steps 6 and 7:** the AI chat header on both apps reads "AI · idle", a status word.

