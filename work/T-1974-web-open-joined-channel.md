---
id: T-1974
title: "Web bug: Open on a joined channel (Explore, @handle card, header) lands on the empty chat list — refreshGeneralTopic only finds a group's General topic, a channel row has no topic"
status: merged
milestone: M5
branch: task/T-1974-web-open-joined-channel
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-1974: Opening a joined channel on web

## Spec (written by Claude, do not edit)

### Why
The lead found this while checking T-1972 on 2026-10-18, and main behaves the same. In the web mock, Explore > Open on "Acme Announcements" (a channel you already joined) navigates to `/`, with no chat selected, instead of opening the channel.

### Facts (read by the lead on 2026-10-18)
- **The lookup.** `apps/web/src/store/effects/topics.ts:23-32`: `refreshGeneralTopic(ctx, groupId)` refreshes the chats, then returns `chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true)?.id`.
- **Why it misses channels.** A channel's chat row carries `groupId` but has no topic. The mock seeds Acme as `kind: 'group', groupId: 'g-acme', chatKind: 'channel'`, with no topic (`packages/mock-backend/src/domains/chats/seed.ts:14-27`). So the lookup returns `undefined`, and every caller then navigates to `/`.
- **Callers that go wrong for a channel:**
  - `apps/web/src/components/ExplorePage.tsx:131-142` (Open);
  - `apps/web/src/routes/GroupHandleRoute.tsx:175-185` (the @handle card's Open);
  - `apps/web/src/routes/AppRoutes.tsx:310`;
  - `apps/web/src/components/ChatHeader.tsx:127`.

### Steps
1. **Add the fallback.** In `refreshGeneralTopic`, when no General topic row matches, return the id of the group's own row that has no topic: `chat.groupId === groupId && chat.topic === undefined`. That is the channel's row.
   - Keep the General-topic match first, so groups behave exactly as before.
   - Add a one-line comment saying why.
2. **Leave the callers alone.** They already navigate to `/c/<id>` when an id comes back.
3. **No tests.** This is UI routing, not one of the crucial areas. The file stays at or under 400 lines.

### Allowed files
- `apps/web/src/store/effects/topics.ts`
- `work/T-1974-web-open-joined-channel.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The channel opens.** In the web mock, the lead goes to Explore and presses Open on Acme Announcements: the channel opens at `/c/<id>`.
- **Groups still work.** Open on a joined group still lands in its General topic.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- **Found the real row shape.** A channel maps through `summaryFor(entry, entry)` in `packages/client-core/src/store/chat-rows.ts`: its row id is `entry.chatJid`, and the row carries **neither `groupId` nor `topic`**. The group association is kept in the web store's `ctx.groupIds` map (`row.id → entry.groupId`), populated by `rememberGroupIds` during boot and on every `refreshChats` (`apps/web/src/store/effects/history.ts:235`). That is why my first fallback (`chat.groupId === groupId`) never matched Acme.
- **Fixed the lookup** in `refreshGeneralTopic` (`apps/web/src/store/effects/topics.ts`): the General-topic match stays first, then the fallback looks for a row whose `ctx.groupIds.get(chat.id) === groupId` and which has `topic === undefined` — the channel's row. Added a one-line comment explaining why.
- Left the four callers unchanged, as the spec says.
- No tests added (UI routing, per the spec). File is 189 lines, under 400.

### Checks run

- **Browser repro** (vite from this worktree on port 5186, Playwright against `/explore?mock=1`, clicking the first `Open`):
  - `node repro.mjs` printed `http://localhost:5186/c/acme%40rooms.zilar.test`.
  - A second run printed the same URL, `path starts with /c/: true`, `channel title visible: true`.
  - Vite was stopped after the run; the temporary repro scripts live outside the repo.
- `pnpm gate` from the repo root:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen) (7.3s)`
  - `PASS format (10.1s)`
  - `PASS lint (5.9s)`
  - `PASS typecheck (8.6s)`
  - `PASS effect (0.7s)`
  - `PASS tests @zilar/web (7.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run separately; the gate ran the web package tests.

### Notes for the lead

- Groups still take the General-topic branch first, which is unchanged, so they should behave exactly as before. I verified the channel path in the browser; I did not click through a joined group in Explore.
- First round's assumption (that the channel row carries `groupId`) was wrong; this round matches the actual row shape via `ctx.groupIds`.
- No files outside the Allowed files were touched.

## Review (written by Claude)

**Approved and merged after one lead fix round.**

**Round 1: the spec's guess was wrong.** The spec assumed a channel's chat row carries `groupId` with no `topic`. The lead's Playwright repro still landed on `/`.

**The worker's fix** (`f249a858e`): a channel's row has neither field. The store maps its id to the group through `ctx.groupIds`, so the fallback now uses `ctx.groupIds.get(chat.id) === groupId && chat.topic === undefined`. The General-topic match still comes first.

**What the lead checked** (web mock):
- Explore > Open on Acme Announcements lands on `/c/acme%40rooms.zilar.test`, with the channel open: header, "120 subscribers" and its message.
- The group paths are unchanged.
