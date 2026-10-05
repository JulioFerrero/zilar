---
id: T-0053
title: "@mentions in groups (web): XEP-0372 references in xmpp-core, an @ picker in the composer, highlighted mentions in bubbles"
status: merged
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
pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/chat-core --filter=@zilar/web
pnpm build
```

### Out of scope
- AIs replying to mentions, and adding AIs to groups (T-0054).
- Mobile mentions.
- Notifications for mentions.
- Mentions inside Markdown AI replies.

## Report (written by the worker when done)

### Summary

Implemented @mentions end to end in the parts the task owns: XEP-0372 build and
parse in `xmpp-core`, the pure mention logic in `chat-core`, the group-member
exposure and mention pass-through in the web store, and the picker, chip
rendering, mock data and tests in the web app. Everything is in Allowed files.
All Checks pass.

The one thing I could not do is the required wire-up in
`packages/xmpp-core/src/client.ts`, which is **not** in Allowed files; see
"Blocked / needs a decision" at the end. Without it the feature is complete in
the app and in tests, but `sendMessage` never puts the `<reference>` elements on
the wire.

### Offset unit (the spec asks me to state it)

- **Internal unit** for `SendMessageOptions.mentions`, `ChatMessage.mentions`,
  `UiMessage.mentions` and every function in `chat-core/src/mentions.ts`:
  **UTF-16 code units** (plain JS string indices). The textarea caret,
  `String.slice` and React all work in that unit, so `rebaseMentions`,
  `insertMention`, `splitMentions` and the backspace handling need no
  conversion.
- **Wire unit** per XEP-0372: **Unicode code points**. `buildMessage` converts
  UTF-16 → code points before writing `begin`/`end`, and `parseMentions`
  converts code points → UTF-16 (after checking the range against the body). The
  conversion uses code-point iteration (`Array.from`), so an emoji before a
  mention shifts the reference by one code point, not by two UTF-16 units.
  `stanza.test.ts` pins this: `'hi 😀 @Ana and @Luis'` with UTF-16 ranges
  `[6,10]`/`[15,20]` is written as `begin/end` `5/9` and `14/19`, and a
  build→parse round trip returns the original UTF-16 ranges.

### What I did

**1. xmpp-core.**
- `namespaces.ts`: `REFERENCE_NAMESPACE = 'urn:xmpp:reference:0'`.
- `types.ts`: `Mention` (`jid`, optional `begin`/`end`), `MentionInput`,
  `ChatMessage.mentions`, `SendMessageOptions.mentions`; both new types exported
  from `index.ts`.
- `stanza.ts`: `buildMessage` adds one `<reference type="mention"
  uri="xmpp:<jid>" begin end/>` per mention. `parseMentions` accepts only
  `type="mention"` with an `xmpp:` URI whose rest is a bare JID (lowercased; the
  resource and any `?query` are dropped), keeps the JID and drops offsets that
  are missing, non-numeric, reversed or outside the body, ignores everything
  else, and caps at 20. It runs inside `decodeMessageStanza`, so it also covers
  forwarded carbons and MAM results.

**2. chat-core.**
- `types.ts`: `MentionMember`, `UiMention`, `UiMessage.mentions`.
- new `mentions.ts`: `findMentionQuery`, `insertMention`, `rebaseMentions`,
  `splitMentions`.
- Three small pure helpers the UI/store share: `filterMentionMembers`
  (case- and accent-insensitive), `isMentionOfMe`, and `mentionsForTrimmedText`
  (keeps ranges valid when the store trims the body). Documented as a deviation.

**3. Web store.**
- `groupMembers(chatId): { jid, name }[]` on both stores. The real store builds
  each JID as `<userId>@<my domain>` and keeps AI members, whose `ai-*` localpart
  is how the UI decides the badge.
- `SendTextOptions.mentions`; `sendText` sets the mentions on the optimistic
  bubble and passes `{ jid, begin, end }` to `core.sendMessage`.
- `toUiMessage` maps received mentions: known member name, else the text at the
  range, else the JID localpart; mentions without usable offsets are dropped.

**4. Composer (groups only; DMs unchanged).**
- Typing `@` opens `MentionPicker` above the composer: members minus me, filtered
  case/accent-insensitively, at most 6 rows, avatar + name + `AI` badge.
- ↑↓ move, Enter/Tab pick, Esc closes, clicking works. A pick inserts `@Name `
  and records the range.
- Ranges are tracked with `rebaseMentions`; Backspace in a mention removes the
  whole `@Name` token; editing inside one drops it; sending an un-picked `@word`
  sends no mention.
- The picker's Esc calls `stopPropagation()`, otherwise `ChatShell`'s window
  Escape handler closed the chat on a narrow layout instead of closing just the
  picker. (Found via a failing Composer test.)

**5. Rendering.**
- `LinkText` now takes mentions and renders `mention-chip` spans; links still
  work around them. A me-mention uses `raised-pill mention-me`.
- `MessageBubble` passes `message.mentions`. The chat-list preview is untouched
  (it keeps using the plain text).

**6. Mock.**
- `apps/web/src/mock/members.ts` with members for every mock group (including
  `ai-*` AIs), exported from `mock/index.ts`.
- One received devTeam message mentioning me (placed before the last message so
  the existing preview assertions still hold).

### Files changed (all Allowed)

Modified: `packages/xmpp-core/src/{stanza.ts,stanza.test.ts,types.ts,namespaces.ts,index.ts,client.ts,core.test.ts}`,
`packages/chat-core/src/{types.ts,index.ts}`,
`apps/web/src/store/{realStore.ts,realStore.test.ts,store.ts}`,
`apps/web/src/components/{Composer.tsx,Composer.test.tsx,LinkText.tsx,MessageBubble.tsx,MessageList.tsx,MessageContent.test.tsx}`,
`apps/web/src/{index.css,mock/index.ts,mock/messages.ts}`.
New: `packages/chat-core/src/{mentions.ts,mentions.test.ts}`,
`apps/web/src/components/MentionPicker.tsx`, `apps/web/src/mock/members.ts`.
`client.ts` and `core.test.ts` were added to scope by the lead (see
"Resolved" below) and `MessageList.tsx` by the review (see Round 2); nothing
else outside the original list changed.

### Commands and real results

```
pnpm install
# Done in 7.9s using pnpm v10.32.1; 1008 packages, 0 added (already up to date)

pnpm format:check
# All matched files use Prettier code style!

pnpm lint
# (no output) exit 0

pnpm typecheck
# Tasks: 9 successful, 9 total

pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/chat-core --filter=@zilar/web
# xmpp-core: 6 files passed, 133 passed | 3 skipped (136)  [core.test.ts 34, was 33]
# chat-core: 7 files passed, 95 passed (95)                [new mentions.test.ts adds 30]
# web:       35 files passed, 246 passed (246)             [Composer 12, MessageContent 13, realStore 68]
# Tasks: 3 successful, 3 total

pnpm build
# Tasks: 2 successful, 2 total (@zilar/web + @zilar/mobile; a cold run took 24s,
# the final confirmation run was fully cached)
```

### Visual check (mock mode, `?mock=1`)

Ran the web dev server (`vite --port 5174`), opened a group
(`/c/c-devteam?mock=1`) in Chrome, and looked at the screenshots. Six PNGs are in
`work/screenshots/T-0053/`:

- `picker-1440x900.png`, `picker-390x844.png` — typing `@an` opens the card above
  the composer with the filter applied (the `Ana` row, avatar + name).
- `sent-two-mentions-1440x900.png`, `sent-two-mentions-390x844.png` — a sent
  outgoing message `@Ana and @Luis please review` with both mentions as chips.
- `received-mention-1440x900.png`, `received-mention-390x844.png` — Luis's
  received message with a raised `@You` chip (the me-mention stands out).

The chips render in place, `@You` uses the raised-pill look, and links are
unaffected. The dev server was stopped afterwards.

### Deviations

- The three extra helpers in `mentions.ts` (`filterMentionMembers`,
  `isMentionOfMe`, `mentionsForTrimmedText`). The first two keep the picker's
  filter and the me-mention check pure and unit-testable; the third keeps ranges
  correct when the store trims the sent body. All are additive.
- The `stopPropagation()` on the picker's Escape, described above.
- `aria-activedescendant` is on the textarea (the element that keeps focus and
  has role textbox), with `role="listbox"` on the picker. That is the correct
  mapping of the spec's accessibility note, which read literally would put
  `aria-activedescendant` on an unfocused listbox.

### Resolved: lead allowed client.ts for the sendMessage wire-up

I first set `status: blocked` because `packages/xmpp-core/src/client.ts` is not
in Allowed files and its `sendMessage` built the stanza with an explicit field
list, dropping `opts.mentions`. The lead confirmed the gap and allowed the
one-line wire-up (plus a `core.test.ts` test). I then:

```ts
buildMessage({ id, to, kind, text, payload: opts.payload, replyTo: opts.replyTo, mentions: opts.mentions })
```

and added `core.test.ts` → "sends the XEP-0372 reference elements for mentions":
a sent `'hi 😀 @Ana'` with UTF-16 `[6,10]` carries a reference with code-point
`begin/end` `5/9`. Nothing else in `client.ts` changed.

### Round 2 (lead review fixes)

**1. should-fix — mentions must not cross chats.** `Composer` now tracks the
chat its mentions belong to and, when `chatId` changes, clears `mentions`,
closes the picker and resets the active row during render (React's "adjust state
when a prop changes"); the draft text itself stays, as before. I used a
render-phase adjustment rather than a `useEffect` because `oxlint`'s
`react(set-state-in-effect)` rejects setting state in an effect.
Test: `Composer.test.tsx` → "clears a picked mention and closes the picker when
the chat changes": pick Luis in `c-viernes`, rerender as `c-devteam`, send →
text `@Luis`, `mentions` undefined.

**2. should-fix — compare the exact `meJid`.** `MessageList` passes
`store.me?.jid` to `MessageBubble`, which forwards it to `LinkText`;
`isMentionOfMe(jid, meJid)` now compares the exact bare JID (resource/query
stripped) and the localpart-only fallback is gone. The Composer uses the same
function. The mock store's default `me` now carries
`jid: 'u-you@zilar.test'`, so mock mode still excludes/highlights me.
Test: `MessageContent.test.tsx` → "does not highlight a same-named mention on
another domain" (`u-you@other.domain` stays a plain `mention-chip`), next to the
existing positive `u-you@zilar.test` case. `MessageList.tsx` changed only for
this one prop pass-through, as allowed.

**3. nit — `buildMessage` range validation.** `buildMessage` now skips mentions
whose `begin`/`end` are not integers, `begin < 0`, `begin >= end`, or
`end > text.length`, and caps at 20, mirroring the parse side.
Test: `stanza.test.ts` → "skips invalid ranges and caps at twenty mentions":
five invalid ranges are dropped and 25 valid ones yield exactly 20 references
(`u0`..`u19`).

Round 2 checks:

```
pnpm format:check
# All matched files use Prettier code style!
pnpm lint
# (no output) exit 0
pnpm typecheck
# Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/chat-core --filter=@zilar/web
# xmpp-core: 134 passed | 3 skipped (137)   [+1 build range/cap test]
# chat-core: 95 passed (95)                 [isMentionOfMe tests updated]
# web:       248 passed (248)               [+1 chat-switch, +1 foreign-domain chip]
# Tasks: 3 successful, 3 total
pnpm build
# Tasks: 2 successful, 2 total (cold run, 20.1s)
```

`PREREVIEW.md` is the lead's pre-review artifact and was left untracked.

## Review (written by Claude)

**Verdict: approved, merged.**

- Scope exceptions granted by the lead: `packages/xmpp-core/src/client.ts` and `core.test.ts` (the `sendMessage` wire-up, which the worker correctly blocked on), and `apps/web/src/components/MessageList.tsx` (passing `meJid` through).
- The round 1 pre-review had two should-fixes: mentions leaking across chats when you switch without sending, and the me-mention check using the localpart only. Both were fixed in round 2 with tests, plus send-side range validation and the cap. The remaining nits are accepted: case normalization is latent, member names can go stale until a reload, the echo signature ignores mentions, and the backspace test asserts only the text.
- Offsets: UTF-16 in the app, code points on the wire, converted in `buildMessage` and the parse. Emoji round trips are tested.
- Live check in Julio's Helium (branch on :5174, live server), in his "Zilar amigos" group, with nothing sent:
  - `@` opens the picker with the real members;
  - `an` + Tab inserts `@Ana (test) `;
  - backspace removes the whole mention;
  - after a hard reload the history loads (8 bubbles, no "Couldn't load").
