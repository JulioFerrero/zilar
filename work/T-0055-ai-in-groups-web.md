---
id: T-0055
title: "AIs in groups (web): group info panel with members and AIs, add or remove my AI, AIs in the @ picker, AI replies rendered as AI"
status: merged
milestone: M2
branch: task/T-0055-ai-in-groups-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0053, T-0054]
estimate: 1.5 days
---

# T-0055: AIs in groups (web)

## Spec (written by Claude, do not edit)

### Goal

T-0054 lets an owner add their AI to a group, and makes the AI reply when a person @mentions it. The server API:
- `POST /api/groups/:id/ais {aiId}`;
- `DELETE /api/groups/:id/ais/:aiId`;
- the group detail now has `ais: [{ aiId, jid, name, ownerId }]`.

This task is the web side, so Julio can do the M2 demo: open a group, add his AI, type `@deep test what do you think?`, and watch the AI answer in the room, looking like an AI.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0054-ai-in-groups-server.md`: the API and the rules (who may add and remove)
- `work/T-0053-mentions-web.md`: the picker and `groupMembers(chatId)` in the store
- `apps/server/src/groups/routes.ts` and `service.ts` **as on the T-0054 branch** (read only; T-0054 isn't merged yet, but its API is final): `git show task/T-0054-ai-in-groups-server:apps/server/src/groups/routes.ts` (and `service.ts`) for the exact response shapes
- `apps/web/src/lib/api.ts` (`groupDetailSchema`, `getGroup`, `listAis`), `store/realStore.ts` (`groupMembers`, the group-member loading, `toUiMessage` sender names), `store/store.ts`
- `apps/web/src/components/ChatHeader.tsx` (the unused "Chat menu" button), `ais/AiPanel.tsx` (the side panel pattern to copy), `routes/ChatView.tsx` (how the AI panel opens with `?panel=ai`), `MentionPicker.tsx`, `MessageBubble.tsx`, `AiBadge.tsx`, `Avatar.tsx`
- `packages/chat-core/src/markdown.ts` (`shouldRenderMarkdown`)
- `docs/design/ui-style.md` (D24)

### Allowed files
- `apps/web/src/lib/api.ts`: the group detail schema, `addGroupAi`, `removeGroupAi`
- `apps/web/src/store/realStore.ts`, `store.ts` and the mock store files, plus their tests
- `apps/web/src/components/ChatHeader.tsx`, a new `components/GroupPanel.tsx` (+ test), `routes/ChatView.tsx` (panel wiring only), `MessageBubble.tsx` (sender AI badge only), `MentionPicker.tsx` (if needed for AI rows)
- `packages/chat-core/src/markdown.ts` and its test: `shouldRenderMarkdown` only
- `apps/web/src/mock/**`
- `work/T-0055-ai-in-groups-web.md` and `work/screenshots/T-0055/**`

**Not allowed:** `apps/server/**`, `apps/mobile/**`, `packages/xmpp-core/**`, `docs/**`.

### Allowed dependencies
None.

### What to build

**1. The group panel** (like the AI panel: a right side panel on wide screens, full screen on narrow ones, opened with `?panel=group`).
- Opened from the header's **Chat menu** button (and by clicking the header title) in group chats.
- It shows:
  - the group title and member count;
  - the **members**, then the **AIs**: avatar, name, role (owner/admin) or the `AI` badge, and for an AI "added by <owner name>".
- **Add my AI** (shown only if I'm an owner or admin of the group and I own at least one AI that isn't in the group yet): a small picker listing my AIs (`listAis`). Adding calls the API, then refreshes the group detail and the store's members.
- **Remove** on an AI row, shown to that AI's owner and to group owners and admins. It has a two-step confirm, as the AI delete does.
- Errors show inline. Pending states disable the buttons.
- D24 look: `--surface` panel, rows as in the chat list, the add button a primary key, remove an outline key.
- Keyboard accessible: focus trap in the narrow full-screen mode, Esc closes.

**2. The store.**
- `groupMembers(chatId)` includes the group's AIs (`jid`, `name`, `isAi: true`), so the **@ picker lists AIs** with the `AI` badge.
- The members refresh after add or remove, and when the panel opens.
- Messages from an AI in a group get the AI's name (from `ais`) and are marked as from an AI (e.g. `UiMessage.senderIsAi` or a lookup the bubble can use; choose the smallest clean change and explain it).

**3. Bubbles.**
- In groups, an AI sender's name shows with the small `AI` badge next to it.
- **AI replies in groups render Markdown**: extend `shouldRenderMarkdown` so an incoming message from an AI sender in a group qualifies too (safety unchanged), with tests. Your own and human messages stay plain.

### Tests (Vitest and Testing Library, no network)
- `GroupPanel`:
  - it lists members and AIs;
  - "Add my AI" shows only for an owner or admin with an eligible AI;
  - add → API call → refresh → the AI appears;
  - remove with confirm → the AI disappears;
  - an API error shows inline;
  - Esc closes.
- The store: AIs in `groupMembers`, a refresh after changes, an AI sender name and flag.
- `MentionPicker`: the AI row has the badge.
- `shouldRenderMarkdown`: an AI sender in a group → true; a human in a group → false.

### Visual check
Mock mode (`?mock=1`); add mock data for a group with an AI. Take screenshots of:
- the group panel with members and an AI;
- the add-AI picker;
- the @ picker showing the AI;
- an AI Markdown reply in the group with the badge.

Screenshots at 1440×900 and 390×844 go to `work/screenshots/T-0055/`. Look at them. **Stop any dev server you start.**

### Acceptance criteria
- [ ] Every check below passes.
- [ ] An owner or admin can add their AI to a group and remove it; the @ picker lists it; its replies show as AI, with Markdown.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/chat-core --filter=@zilar/web
pnpm build
```

### Out of scope
- Mobile; renaming groups; adding people from this panel (a later task can reuse it).
- Streaming drafts in groups.

## Report (written by the worker when done)

### Summary

Implemented the web side of "AIs in groups": a group info panel (members and
AIs, add my AI, remove an AI), the store plumbing behind it, AIs in the `@`
picker, and AI replies in a group rendered with the `AI` badge and Markdown.
Mock data and eight screenshots come with it. Every Check passes and only the
Allowed files changed.

### What I did

**1. chat-core — `shouldRenderMarkdown` (markdown.ts).** An incoming message
renders as Markdown when: it is in an AI chat (unchanged), **or** it is a group
message whose sender is an AI (`ai-` localpart). Your own message and a human
group message stay plain. The `ai-` check is a small private helper in the file.

**2. API (`lib/api.ts`).** `groupDetailSchema` now carries
`ais: [{ aiId, jid, name, ownerId }]` (the T-0054 detail shape). Added
`addGroupAi(groupId, aiId)` → `POST /groups/:id/ais` and
`removeGroupAi(groupId, aiId)` → `DELETE /groups/:id/ais/:aiId`, both returning
the fresh `GroupDetail`.

**3. Store (`store.ts`, `realStore.ts`).** New members on `ChatStore`:
- `groupInfo(chatId)` — the cached group detail (people + AIs);
- `refreshGroupInfo(chatId)` — reloads it (the panel calls this on open);
- `addGroupAi(chatId, aiId)` / `removeGroupAi(chatId, aiId)` — call the API and
  refresh both the detail and the mention members; they reject so the panel can
  show the error inline;
- `listMyAis()` — the AIs the user owns, for the add picker.

The real store caches the whole `GroupDetail` per chat and rebuilds the mention
member map from it, so **`groupMembers` now includes the group's AIs** (their
real `ai-<id>@<domain>` JID and name). The AI name therefore comes from `ais`,
which is what "messages from an AI get the AI's name (from `ais`)" asked for.
The mock store seeds `groupInfos` from the new mock groups and mutates them on
add/remove, so the panel is fully usable in `?mock=1`.

**4. Group panel (`components/GroupPanel.tsx`, new).** A right side panel on
wide screens, full screen on narrow ones, opened with `?panel=group`. It shows
the title + member count, the members (owner/admin role pills), then the AIs
(avatar, name + `AI` badge, "Added by <owner>", a `Remove` outline button). The
**Add my AI** primary button appears only for an owner/admin who owns at least
one active AI that is not already in the group; it opens a small picker of those
AIs. Remove has a two-step inline confirm. Errors show inline; pending states
disable the buttons. Esc closes (document capture phase so it beats ChatShell's
narrow-layout window handler), and on narrow layouts a Tab focus trap keeps focus
inside the panel.

**5. Header / route wiring (`ChatHeader.tsx`, `ChatView.tsx`).** In a group the
header title and the Chat menu button open the panel; the AI DM wiring is
unchanged. `ChatView` reads `?panel=ai`/`?panel=group` on mount.

**6. Bubbles (`MessageBubble.tsx`).** In a group, an AI sender's name now shows
the small `AI` badge next to it. Markdown for those replies comes from the
extended `shouldRenderMarkdown`. `MentionPicker.tsx` needed no change: it
already derives the badge from the JID.

**7. Mock (`mock/**`).** New `mock/groups.ts` with the detail (people + AIs) of
every mock group and the owned AIs; `mock/members.ts` now derives from it; one
AI Markdown reply was added to `Dev team` (before `Tests pass. Merge?`, which
several existing tests assert as the last message).

### AI-sender flag: the choice

`packages/chat-core/src/types.ts` is **not** in the Allowed files, so I could not
add a `UiMessage.senderIsAi` field. I used the spec's alternative, "a lookup the
bubble can use": AI-ness comes from the sender's `ai-` JID. `MessageBubble`
reuses the existing `isAiMentionJid` helper from `MentionPicker`, and
`shouldRenderMarkdown` has its own private copy (no cross-package import). The
store test asserts both halves for a group AI message: `senderName` is the name
from `ais` and `senderId` is the `ai-...` JID (the flag).

### Files changed (all Allowed)

Modified: `packages/chat-core/src/{markdown.ts,markdown.test.ts}`,
`apps/web/src/lib/api.ts`,
`apps/web/src/store/{store.ts,realStore.ts,realStore.test.ts,reload.test.tsx}`,
`apps/web/src/components/{ChatHeader.tsx,MessageBubble.tsx}`,
`apps/web/src/routes/ChatView.tsx`,
`apps/web/src/mock/{index.ts,members.ts,messages.ts}`,
`work/T-0055-ai-in-groups-web.md`.
New: `apps/web/src/components/{GroupPanel.tsx,GroupPanel.test.tsx,MentionPicker.test.tsx}`,
`apps/web/src/mock/groups.ts`, `work/screenshots/T-0055/*`.

### Commands and real results

```
pnpm install
# Already up to date; Done in 840ms using pnpm v10.32.1

pnpm format:check
# All matched files use Prettier code style!

pnpm lint
# (no output) exit 0

pnpm typecheck
# Tasks: 9 successful, 9 total

pnpm exec turbo test --force --filter=@zilar/chat-core --filter=@zilar/web
# chat-core: 7 files passed, 97 passed (97)   [markdown.test.ts +2 cases]
# web:       37 files passed, 268 passed (268) [GroupPanel 8, MentionPicker 1,
#            realStore +4; +6 files over T-0053's 246/248]
# Tasks: 2 successful, 2 total

pnpm build
# Tasks: 2 successful, 2 total
```

### Visual check (mock mode, `?mock=1`)

`ZILAR_API_URL` pointed at a throwaway Python server (in the approved temp
dir, not committed) that answers `/api/auth/get-session`, so the app
authenticates and the mock store is used; this worktree's Vite ran on
`localhost:5242`. Both were stopped afterwards. Eight PNGs at 1440×900 and
390×844 are in `work/screenshots/T-0055/`:

- `group-panel-1440x900.png` / `group-panel-390x844.png` — "Dev team",
  "6 members", You (owner), Ana (admin), Luis, Marco; Dev-1 and QA-1 with the
  `AI` badge and "Added by You"; the **Add my AI** key.
- `add-ai-picker-1440x900.png` / `add-ai-picker-390x844.png` — the picker with
  the two eligible AIs, Marketing AI and Researcher (Dev-1/QA-1 are correctly
  excluded as already in the group), each with the badge.
- `mention-picker-1440x900.png` / `mention-picker-390x844.png` — typing `@`
  opens the picker with Ana, Luis, Marco and the AI rows Dev-1 and QA-1, badged.
- `ai-markdown-reply-1440x900.png` / `ai-markdown-reply-390x844.png` — Dev-1's
  reply with the `AI` badge and rendering Markdown (heading, bold, inline code,
  bullet list).

### Deviations

- **The panel is store-driven** (`store.groupInfo`, `store.listMyAis`,
  `store.addGroupAi`, `store.removeGroupAi`) instead of calling `listAis` and the
  API functions directly as `AiPanel` does. That is what makes the panel work in
  `?mock=1` (there is no mock fetch layer), and it keeps the visual check
  honest. The real store does the actual API calls; the store tests pin them.
- Two new test files: `GroupPanel.test.tsx` and `MentionPicker.test.tsx` (the
  spec asks for a MentionPicker badge test and there was no MentionPicker test).
- `MentionPicker.tsx` badges rows from the JID; since Round 2 its check is the
  shared `isAiJid` from `@zilar/chat-core` (no local duplicate).
- Mock groups use the fixed `zilar.test` domain (as the previous mock members
  did); the real store builds JIDs from the signed-in user's domain.
- The mock group member lists do not match every `mockChats.memberCount` (that
  mismatch predates this task); the panel counts from the loaded detail.

### Open questions / notes

- If the group detail request fails in the real store, the panel stays on
  "Loading…". A retry/error state could be a later touch, but it is outside the
  spec's error list (which is about add/remove).
- `memberCount` on the chat list still counts people only (T-0054's server
  leaves `listGroupsForUser` unchanged), so the header subtitle and the panel's
  "N members" can differ by the AI count. The panel counts people + AIs.

### Round 2 (lead review fixes)

Three fixes from the pre-review, no scope expansion.

**1. One `ai-` rule.** New `packages/chat-core/src/ai.ts` exports `isAiJid(jid)`
(strips `/resource` and `?query`, then checks the localpart), exported through
`packages/chat-core/src/index.ts`. `markdown.ts` imports it for
`shouldRenderMarkdown` and drops its private copy; `MentionPicker.tsx` imports
it and its exported duplicate `isAiMentionJid` is gone; `MessageBubble.tsx`
imports `isAiJid` from `@zilar/chat-core` (it no longer imports the picker).
Added `packages/chat-core/src/ai.test.ts` for the resource/query cases.

**2. The tautological assertion is gone.** The realStore test now renders the
store-produced group AI message through `MessageBubble` (body `**done**`) and
asserts the sender name `Dev-1`, the `AI` badge and real Markdown
(`<strong>done</strong>`). It no longer asserts `senderId.startsWith('ai-')`.

**3. The panel resets on a chat change.** `ChatView` tracks the chat the open
panel belongs to and, when `chat.id` changes, recomputes the panel from the
current `?panel=` value, so switching chats closes it unless the URL still asks
for one. New `apps/web/src/routes/ChatView.test.tsx`: `?panel=group` opens the
panel; opening it via the header then switching away and back leaves it closed.
I temporarily disabled the reset to confirm the test fails without it (1 failed)
and passes with it.

Round 2 checks:

```
pnpm format:check   # All matched files use Prettier code style!
pnpm lint           # (no output) exit 0
pnpm typecheck      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/chat-core --filter=@zilar/web
# chat-core: 8 files passed, 99 passed (99)  [ai.test.ts +2]
# web:       38 files passed, 270 passed (270) [ChatView.test +2; realStore test rewritten]
# Tasks: 2 successful, 2 total
pnpm build          # Tasks: 2 successful, 2 total
```

Note: the checks run `prettier --check .`, which also looks at the untracked
`PREREVIEW.md` (it is not in `.prettierignore`). I ran `prettier --write` on it
(adds one blank line) so `format:check` passes; it stays untracked and
unmodified in git, never committed.

## Review (written by Claude)

**Approved and merged by Claude.**

- Round 1 delivered the group panel (members with roles, an AIs section, Add my AI and Remove), AIs in the @ picker, and group AI replies with the badge and Markdown. The store-driven panel deviation is accepted, since it's what makes `?mock=1` work.
- Round 2 fixed all three review items:
  - one shared `isAiJid` in `@zilar/chat-core`, used by the Markdown rule, MentionPicker and MessageBubble;
  - a real MessageBubble render test (the badge plus `<strong>`);
  - the ChatView panel resets on a chat change, with a test shown to fail without the fix.
- Scope: `chat-core/src/ai.ts`, its test and the `index.ts` export, plus `ChatView.test.tsx`, were added at the lead's request in round 2. They're approved.
- Accepted nits, not blocking:
  - in the room, the occupant nick wins over the `ais` name;
  - the dropped `@` guard in the member-JID builder can't be reached;
  - there's no retry when the group detail fails to load (disclosed).
- The pre-reviewer re-ran the checks: format, lint, typecheck, chat-core at 99 passing, web at 270 passing, and build all green.
