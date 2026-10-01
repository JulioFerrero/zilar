---
id: T-0144
title: Mobile: channels (read-only feed for subscribers, admin posting)
status: todo
milestone: M5
branch: task/T-0144-mobile-channels
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0124, T-0139]
estimate: 1 day
---

# T-0144: Mobile: channels

## Spec (written by Claude, do not edit)

### Why
Channels (T-0124) are one-way feeds: only the owner and admins post, subscribers read. The mobile app does not know them yet: a channel would show a composer that fails when a subscriber sends. Mobile is the smaller share (about 20%): keep it small and follow the existing mobile patterns, store and mock. Read `AGENTS.md` first, including the security checklist, and the Spec, Report and Review of `work/T-0124-channels.md` for the wire contract (the group kind, `description`, the member role route, the admins slice visible to subscribers).

### What to build
1. Chat list and header: a channel shows as a channel (megaphone-style marker, subscriber count instead of "members"), the title and description in the group/channel screen.
2. Composer: subscribers see a read-only bar ("Only admins can post", with a Mute toggle) instead of the composer; owner and admins keep the composer. The decision uses the role from the chat/group data and re-reads after a role change (a promoted subscriber gets the composer without a restart).
3. Channel screen (the group screen route from T-0139): channel info, description, admins and owner list (subscribers see only that slice, never the subscriber list), invite links (owner/admin, the existing sheet), leave; for the owner: promote a subscriber to admin and demote an admin (`PUT /api/groups/:id/members/:userId/role`), the last-admin guard error shown as a plain message.
4. Create channel: a "New channel" entry next to "New group" (title, optional description); joins by link show "Join channel".
5. Mock mode: one demo channel where the viewer is a subscriber and one where they are admin.
6. Out of scope: server, web, push, dependencies.

### Read first
`AGENTS.md`, `work/T-0124-channels.md`, the web `ChannelComposerBar.tsx` and `ChannelPanel.tsx` for behaviour, `apps/mobile/src/app/group/[id].tsx`, the composer and the real store.

### Allowed files
`apps/mobile/**`, `work/T-0144-mobile-channels.md`. Not allowed: server, web, packages (say so in the Report and stop if a shared type must change), dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

## Review (written by Claude)
