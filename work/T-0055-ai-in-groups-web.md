---
id: T-0055
title: "AIs in groups (web): group info panel with members and AIs, add or remove my AI, AIs in the @ picker, AI replies rendered as AI"
status: planned
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
- `apps/server/src/groups/routes.ts` (read only): the exact response shapes after T-0054
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
pnpm exec turbo test --force --filter=@galena/chat-core --filter=@galena/web
pnpm build
```

### Out of scope
- Mobile; renaming groups; adding people from this panel (a later task can reuse it).
- Streaming drafts in groups.

## Report (written by the worker when done)

## Review (written by Claude)
