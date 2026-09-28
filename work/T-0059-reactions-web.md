---
id: T-0059
title: Message reactions (web) — XEP-0444 in xmpp-core (archived with a store hint), a quick-reaction bar, reaction chips under bubbles
status: review
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

### Summary

Added XEP-0444 reactions end to end: build/parse in `xmpp-core` (with the
`urn:xmpp:hints` store hint), a pure reducer and summariser in `chat-core`, the
store plumbing (live, MAM history, optimistic toggle with revert, alias-aware
matching), and the UI (a 6-emoji quick bar in the actions menu and raised
reaction chips under bubbles). Mock data seeds reactions in a DM and a group.
All Checks pass and only Allowed files changed.

### What I did

**1. xmpp-core.**
- `namespaces.ts`: `REACTIONS_NAMESPACE` (`urn:xmpp:reactions:0`) and
  `HINTS_NAMESPACE` (`urn:xmpp:hints`).
- `types.ts`: `ChatMessage.reactions?: MessageReactions`
  (`{ targetId, emojis }`), the `MessageReactions` interface, and
  `XmppCore.sendReactions(chatJid, kind, targetId, emojis)`.
- `stanza.ts`: `buildReactions` (a body-less `<message>` with
  `<reactions id=…>` and `<store xmlns="urn:xmpp:hints"/>`), `parseReactions`,
  and a shared `sanitizeReactions` that keeps only real emoji graphemes of 1–8
  code points, drops duplicates and caps at 6. `decodeMessageStanza` now emits a
  message when a reactions element is present even with no body/payload, so
  carbons and MAM go through the same parse.
- `client.ts`: `sendReactions` (requires online, rejects on failure).

**2. chat-core `reactions.ts` (new).** Pure reducer:
- `applyReaction(state, { targetId, reactorJid, emojis, order })` — the latest
  order per (target, reactor) wins; an empty set clears; dedupes/caps.
- `summarize(state, targetId, meJid)` → `[{ emoji, count, mine, reactors }]`
  in first-used order (`reactors` are the reactor JIDs).
- `mergeTargets`, `emptyReactions`, `QUICK_REACTIONS`.
- `types.ts`: `UiMessage.reactions?: UiReaction[]` and the `UiReaction`
  interface (its `reactors` are display names, unlike `summarize`).

**3. Store.** `ChatStoreState.reactions` holds the updates per chat, keyed by
the alias-resolved target id. `ChatStore.react(chatId, messageId, emoji)`:
- toggles my emoji in my set, applies optimistically, and sends the full set
  through `sendReactions`; on a send error it re-applies the previous set;
- live messages with `reactions` are ingested and returned early, so they never
  render as bubbles and never touch the preview or unread count;
- `loadPreview`, `openHistory` and `loadOlder` ingest reactions from every page
  (including reactions for messages not loaded yet) and filter the reaction
  stanzas out of the rendered list; `toUiMessage` attaches the chips.
- **Matching is alias-aware, like read markers:** reaction targets are stored
  under `aliasRoot(targetId)` and the lookup uses `aliasRoot(message.id)`, the
  same alias map `sameMessage` uses; `linkMessageIds` also migrates an existing
  target onto the surviving root. So a reaction to my optimistic `local-1`
  survives the server echo replacing it with `srv-1`.
- Reactor names: "You" for me, the chat title in a DM, else the group member
  name, then the room occupant nick, then "Someone".

**4. UI.** `MessageActionsMenu` gained a row of the 6 quick reactions above
Reply/Copy/Delete (each a `menuitem` with `aria-label="React with <emoji>"`).
The new `ReactionChips` renders raised pills (emoji + count, mine with the
pressed/segment look) inside the bubble's alignment, wraps, and gives each chip
`aria-pressed`, an `aria-label` like `👍 3, including you`, and a `title` with
the reactor names. Chips are hidden while a draft is generating. The CSS adds
the `reaction-chip`/`reaction-chip-mine` utilities (and reduced-motion rules).
The menu is anchored to the bubble's own side (`align`), which also fixes a
mobile clip on incoming bubbles.

**5. Mock / data.** `mock/messages.ts` seeds reactions on incoming and outgoing
messages in `c-ana` (DM) and `c-viernes` (group), including big-emoji and mine;
the mock store's `react` toggles "You" on the message's chips.

### Files changed (all Allowed)

Modified: `packages/xmpp-core/src/{namespaces,types,stanza,client,index}.ts`,
`packages/xmpp-core/src/{stanza,core}.test.ts`,
`packages/chat-core/src/{types,index}.ts`,
`apps/web/src/store/{store,realStore}.ts`, `apps/web/src/store/realStore.test.ts`,
`apps/web/src/components/{MessageBubble,MessageActionsMenu}.tsx`,
`apps/web/src/index.css`, `apps/web/src/mock/messages.ts`,
`work/T-0059-reactions-web.md`.

New: `packages/chat-core/src/reactions.ts`,
`packages/chat-core/src/reactions.test.ts`,
`apps/web/src/components/ReactionChips.tsx`,
`apps/web/src/components/ReactionChips.test.tsx`,
`work/screenshots/T-0059/*.png`.

### Commands (real results)

```bash
pnpm install       # 1010 packages, done in 7s
pnpm format:check  # All matched files use Prettier code style!
pnpm lint          # oxlint ., exit 0, no findings
pnpm typecheck     # 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/xmpp-core --filter=@galena/chat-core --filter=@galena/web
                   # xmpp-core 146 passed | 3 skipped; chat-core 110 passed; web 294 passed; 3 tasks successful
pnpm build         # 2 successful, 2 total (@galena/web, @galena/mobile)
```

### Visual check (mock mode, `?mock=1`)

`GALENA_API_URL` pointed at a throwaway Python server (in the approved temp
dir, not committed) that answers `/api/auth/get-session`, so the app
authenticates while the mock store is used. This worktree's Vite ran on
`localhost:5242`. Both were stopped afterwards. Six PNGs at 1440×900 and
390×844 are in `work/screenshots/T-0059/`:

- `dm-1440x900.png` / `dm-390x844.png` — Ana DM: my `Deal` has `👍 1`; Ana's
  `See you tonight ❤️` has `❤️ 2` (mine, pressed) and `👍 1`.
- `group-1440x900.png` / `group-390x844.png` — "Viernes 🍻": Ana's `MVP 🏆` has
  `🏆 3` and `👍 1` (mine); my `On my way` has `🚀 2` (mine).
- `group-menu-1440x900.png` / `group-menu-390x844.png` — the actions menu with
  the quick-reaction row above Reply, Copy text and Delete.

I looked at each one; chips align under their bubble on both sides, mine use the
pressed look, and the quick bar fits at 390 px.

### Deviations

- `MessageList.tsx`/`ChatView.tsx` are **not** in Allowed files, so the bubble
  cannot receive an `onReact` prop from the route. `MessageBubble` reads the
  store itself with `useChatStoreApi` (as `MessageList` already does) and calls
  `react`. The standalone `MessageBubble` render in `realStore.test.ts` is now
  wrapped in `AuthProvider` + `ChatStoreProvider` (that test file is Allowed).
- `summarize` returns reactor JIDs (it is pure and cannot resolve names); the
  store maps them to display names for `UiReaction.reactors`.
- Reaction order is the update's timestamp in milliseconds. Ties are resolved
  last-applied-wins, which is also what makes the optimistic toggle and its
  revert work. This matches "latest update wins"; it is not a bit-exact
  stanza-order counter.
- A reaction update never changes the chat-list preview or unread count (the
  spec only says it must not render as a bubble; I treated a reaction as not a
  message).

### Open questions / notes

- The group target is `ChatMessage.id`, which is already the stanza-id when
  known (`messageId` prefers `<stanza-id by=room>`), so group reactions use the
  stanza-id as the XEP requires.
- A reaction sent before my optimistic message's echo arrives would carry the
  local id; the toggle is still matched locally via the alias, but the wire
  target uses the UI's message id (the same limitation `replyTo` already has).
  In practice the echo lands in milliseconds.

## Review (written by Claude)
