---
id: T-0053
title: "@mentions in groups (web): XEP-0372 references in xmpp-core, an @ picker in the composer, highlighted mentions in bubbles"
status: planned
milestone: M2
branch: task/T-0053-mentions-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0047, T-0049]
estimate: 1.5 days
---

# T-0053: @mentions (web)

## Spec (written by Claude, do not edit)

### Goal

M2's goal is "first AI in a room": an AI in a group replies when it's **@mentioned** (`docs/PROJECT_PLAN.md` §9 rule 1: "A person @mentions AIs: only those AIs reply"). Nothing supports mentions yet. This task adds them end to end on the web, for every member (humans and, later, AIs):
- typing `@` in a group's composer opens a member picker;
- the sent message carries **XEP-0372 references** (`<reference xmlns="urn:xmpp:reference:0" type="mention" uri="xmpp:<bare-jid>" begin=".." end=".."/>`);
- received mentions render highlighted, and a mention of **me** stands out.

The server-side AI reply to mentions is a later task (T-0054). It will read the `mentions` field this task adds to `ChatMessage`.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §6, the table row "XEP-0372 References" and the example stanza near line 302 (search for `urn:xmpp:reference:0`)
- The XEP-0372 rules you need: `begin` and `end` are **character offsets into the body**. The spec counts Unicode code points, so be careful with emoji: JS strings are UTF-16. Convert, test it, and say in the Report which unit you used.
- `packages/xmpp-core/src/stanza.ts` (`buildMessage`, `parseReply` and the message parse around line 600), `types.ts` (`ChatMessage`, `SendMessageOptions`), `namespaces.ts`, `stanza.test.ts`
- `packages/chat-core/src/types.ts` (`UiMessage`)
- `apps/web/src/store/realStore.ts`: `groupMembers` (loaded from `api.getGroup`), `toUiMessage`, send; `store.ts` (the store interface)
- `apps/web/src/components/Composer.tsx`, `MessageBubble.tsx`, `LinkText.tsx`, `MarkdownText.tsx`, `ReplyQuote.tsx`
- `docs/design/ui-style.md` §4 and §5 (D24: the popover is a `--surface` card with `--border-strong`, 12 px radius, and a soft shadow, like the message actions menu)

### Allowed files
- `packages/xmpp-core/src/stanza.ts`, `types.ts`, `namespaces.ts`, `index.ts` (exports), plus `stanza.test.ts` and new tests in that folder
- `packages/chat-core/src/types.ts`, plus a new `packages/chat-core/src/mentions.ts` and `mentions.test.ts`, and the export line in `index.ts`
- `apps/web/src/store/realStore.ts`, `store.ts`, `mockStore` files if the store has one (to expose group members and pass mentions through), plus their tests
- `apps/web/src/components/Composer.tsx`, `MessageBubble.tsx`, `LinkText.tsx`, a new `MentionPicker.tsx`, plus tests; `apps/web/src/index.css` (the mention chip style)
- `apps/web/src/mock/**`: mock members and a mock message with a mention
- `work/T-0053-mentions-web.md` and `work/screenshots/T-0053/**`

**Not allowed:** `apps/server/**`, `apps/mobile/**`, `docs/**`, and `MarkdownText.tsx` (AI replies keep their Markdown path; mentions inside AI replies are out of scope).

### Allowed dependencies
None.

### What to build

**1. xmpp-core.**
- `SendMessageOptions.mentions?: { jid: string; begin: number; end: number }[]`. `buildMessage` adds one `<reference type="mention" uri="xmpp:<jid>" begin end/>` per mention.
- The parse fills `ChatMessage.mentions?: { jid: string; begin?: number; end?: number }[]` from the references.
  - Accept only `type="mention"` with an `xmpp:` URI whose rest is a valid bare JID (lowercase it; drop the resource and any query).
  - Ignore offsets that are out of range or with `begin >= end`: keep the JID and drop the offsets.
  - Ignore everything else. Cap it at 20 mentions per message.
- This works for MAM history too (it runs through the same parse).
- Tests: build and parse round trips, emoji offsets, a bad URI, a wrong type, bad offsets, the cap, a reference inside a forwarded carbon, and a MAM result.

**2. chat-core.**
- `UiMessage.mentions?: { jid: string; name: string; begin: number; end: number }[]`: only the mentions with valid offsets that fit the body.
- A pure `mentions.ts`:
  - `findMentionQuery(text, caret)` returns the `@query` being typed at the caret: after the start or whitespace, until the caret, with no spaces;
  - `insertMention(text, caret, member)` returns the new text, the caret, and the mention range;
  - `rebaseMentions(prevText, nextText, mentions)` keeps the ranges valid, or drops a range, after the user edits the text around or inside a mention (edit inside → drop it);
  - `splitMentions(text, mentions)` returns segments for rendering.
  These carry the tricky logic, so test them thoroughly (tables of cases).

**3. Web store.**
- Expose the members of a group chat to the UI, e.g. `groupMembers(chatId): { jid, name }[]` (or the equivalent in store state), loaded as today. It includes the AIs that are members, once a later task can add them; the AI badge comes from the JID (`ai-*`).
- `sendMessage` passes the mentions through. `toUiMessage` maps the received mentions to names: the known member name, otherwise the text at the range, otherwise the JID's local part.

**4. Composer (groups only; DMs unchanged).**
- Typing `@` opens the **MentionPicker** above the composer: the members, excluding me, filtered by the query (case- and accent-insensitive on the name), at most 6 rows, each with the avatar, the name and the `AI` badge.
- Keyboard: ↑↓ move, Enter and Tab pick, Esc closes. Clicking works too. Picking inserts `@Name ` and records the mention.
- The input is a textarea, so mentions are tracked as ranges with `rebaseMentions`, not rich spans. Backspace into a mention removes the whole `@Name` token and its mention.
- On send, the mentions go with the message. Sending plain text with an `@word` that wasn't picked sends no mention.
- Accessibility: `role="listbox"` and `aria-activedescendant` on the picker; the textarea keeps focus.

**5. Rendering.**
- In non-Markdown bubbles (`LinkText` path), mention ranges render as a **mention chip**: `#ededed` text at weight 600 on a subtle `rgba(255,255,255,.08)` pill with a 4 px radius. In outgoing (white) bubbles, use `#0a0a0a` text on `rgba(0,0,0,.08)`.
- A mention of **me** uses the raised-pill look (`raised-pill`), so it's noticeable.
- Links still work around mentions.
- The chat list preview shows the plain text (unchanged).

### Tests (Vitest, no network)
- xmpp-core and chat-core as above.
- Composer:
  - `@` opens the picker;
  - filtering, keyboard navigation and pick → text plus a mention;
  - Esc closes;
  - backspace removes the whole mention;
  - an edit inside a mention drops it;
  - send passes the mentions;
  - no picker in DMs.
- MessageBubble: the chips render in the right place, with emoji before the mention; the me-mention gets the raised look.
- realStore: a received stanza with references → `UiMessage.mentions` with names; send → the references reach `core.sendMessage`.

### Visual check
Mock mode (`?mock=1`), in a group:
- the picker open with the filter applied;
- a sent message with two mentions;
- a received message mentioning me.

Screenshots at 1440×900 and 390×844 go to `work/screenshots/T-0053/`; look at them yourself. **Stop any dev server you start.**

### Acceptance criteria
- [ ] Every check below passes.
- [ ] References are built and parsed per XEP-0372, with correct offsets for emoji.
- [ ] The picker works by keyboard and mouse; mentions survive edits correctly.
- [ ] Mentions render as chips; a me-mention stands out.
- [ ] Only the Allowed files changed.

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
- AIs replying to mentions, and adding AIs to groups (T-0054).
- Mobile mentions.
- Notifications for mentions.
- Mentions inside Markdown AI replies.

## Report (written by the worker when done)

## Review (written by Claude)
