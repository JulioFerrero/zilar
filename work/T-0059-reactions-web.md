---
id: T-0059
title: Message reactions (web) — XEP-0444 in xmpp-core (archived with a store hint), a quick-reaction bar, reaction chips under bubbles
status: planned
milestone: M1
branch: task/T-0059-reactions-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0053, T-0055]
estimate: 1.5 days
---

# T-0059: Reactions (web)

## Spec (written by Claude, do not edit)

### Goal

The MVP list (`docs/PROJECT_PLAN.md` §21) has reactions, and the web has none. Add Telegram-like reactions to DMs and groups:
- a quick bar of 6 emoji in the message actions menu;
- chips under a bubble with counts;
- click a chip to toggle my reaction;
- they survive reloads (they come back from MAM history).

### Protocol (XEP-0444, decided)
- A reaction update is a message to the chat (`chat` or `groupchat`) with **no body**:

  ```xml
  <reactions xmlns="urn:xmpp:reactions:0" id="TARGET"><reaction>👍</reaction>…</reactions>
  ```

  plus `<store xmlns="urn:xmpp:hints"/>`, so ejabberd archives it in MAM even without a body.
- It carries the reactor's **complete current set** for that message. An empty `<reactions id=…/>` clears it.
- `TARGET`:
  - in DMs, the target message's id as both sides know it;
  - in groups, the target's **stanza-id** (XEP-0359), as the XEP requires.
  `ChatMessage.id` is already "the archive stanza-id when known, else the message id", so use it. Check that the web matches reactions to messages with the same alias-aware comparison that read markers use (`sameMessage` in `realStore.ts`), and say so.
- Only emoji, 1–8 code points per reaction, at most 6 distinct reactions per reactor per message. Ignore invalid input on parse.
- The latest update per (reactor, target) wins, in stanza order (MAM order for history, arrival order live).

### Read first
- `AGENTS.md` (mandatory)
- `packages/xmpp-core/src/stanza.ts`, `types.ts`, `client.ts` (`sendMessage`, the message parse, `displayed` handling as the model for a body-less stanza), `namespaces.ts`, and their tests
- `packages/chat-core/src/types.ts` (`UiMessage`)
- `apps/web/src/store/realStore.ts`: `toUiMessage`, the MAM history merge, live message handling, `sameMessage`, and how read markers are applied. Also `store.ts` and the mock store.
- `apps/web/src/components/MessageBubble.tsx`, `MessageActionsMenu.tsx`, `index.css`, `docs/design/ui-style.md` (D24: the chips are **raised pills**; mine is the pressed or active segment look)

### Allowed files
- `packages/xmpp-core/src/stanza.ts`, `types.ts`, `client.ts` (a `sendReactions(chatJid, kind, targetId, emojis[])` method and the parse), `namespaces.ts`, `index.ts`, plus tests
- `packages/chat-core/src/types.ts`, plus a new `packages/chat-core/src/reactions.ts` and its test (pure aggregation), and the `index.ts` export
- `apps/web/src/store/realStore.ts`, `store.ts`, the mock store files, plus tests
- `apps/web/src/components/MessageBubble.tsx`, `MessageActionsMenu.tsx`, a new `ReactionChips.tsx` and its test, `apps/web/src/index.css`
- `apps/web/src/mock/**`
- `work/T-0059-reactions-web.md` and `work/screenshots/T-0059/**`

**Not allowed:** the server, mobile, docs.

### What to build
1. **xmpp-core.**
   - Build and parse as above.
   - `ChatMessage.reactions?: { targetId: string; emojis: string[] }` on a body-less reactions message. It isn't a chat message for display: the store must not render it as a bubble.
   - Carbons and MAM go through the same parse.
2. **chat-core `reactions.ts`:** a pure reducer.
   - `applyReaction(state, { targetId, reactorJid, emojis, order })` returns the new state. The latest order wins.
   - `summarize(state, targetId, meJid)` returns `[{ emoji, count, mine, reactors[] }]` in first-used order.
   - Test it thoroughly: a replace set, a clear, out-of-order MAM items, duplicates.
3. **Store.**
   - Keep the reactions per chat and apply them from live messages and from history pages (older pages can hold reactions to messages you haven't loaded yet: keep them and show them when the target loads).
   - `UiMessage.reactions` comes from `summarize`.
   - `react(chatId, messageId, emoji)` toggles my emoji in my set and sends the full set. It's optimistic, and it reverts on a send error.
   - Reactor names come from the member names in groups, and from the chat title and "You" in DMs.
4. **UI.**
   - The actions menu gets a row of 6 quick reactions (👍 ❤️ 😂 😮 😢 🙏) above Reply and Copy. Clicking one reacts and closes the menu.
   - Under the bubble (inside the group's alignment), `ReactionChips` shows raised pills (emoji + count). Mine uses the pressed look. Clicking a chip toggles my reaction. The tooltip, via `title`, lists the reactor names.
   - Chips wrap. Big-emoji messages get chips too. The generating draft has none.
   - Keyboard: the chips are buttons with `aria-pressed` and `aria-label`, e.g. "👍 3, including you".

### Tests (Vitest and Testing Library, no network)
- xmpp-core:
  - build, with the store hint and an empty clear;
  - parse, with invalid emoji dropped, the cap, and body-less handling;
  - carbons and MAM.
- chat-core: the reducer cases above.
- Store:
  - live toggle and revert on error;
  - history with reactions before and after the target;
  - a reaction message never renders as a bubble;
  - group targets by stanza-id.
- UI:
  - the quick bar reacts;
  - a chip toggles;
  - counts and mine;
  - `aria-pressed`.

### Visual check
Mock mode, in a DM and a group:
- chips on incoming and outgoing bubbles, including mine;
- the menu with the quick bar.

Screenshots at 1440×900 and 390×844 go to `work/screenshots/T-0059/`. Look at them. **Stop any dev server you start.**

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/xmpp-core --filter=@galena/chat-core --filter=@galena/web
pnpm build
```

### Out of scope
- A full emoji picker (only the 6 quick ones plus toggling existing chips).
- Mobile.
- AIs reacting.
- Notifications.

## Report (written by the worker when done)

## Review (written by Claude)
