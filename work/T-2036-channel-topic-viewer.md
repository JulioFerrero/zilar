---
id: T-2036
title: "Channel topic views know the viewer: owners and admins of a channel see its full General-topic member list again, subscribers keep the narrowed managers-only list (T-1992 follow-up) — optional viewerId through toTopicViews, passed by the chat list and topics list routes — with a test"
status: merged
milestone: M5
branch: task/T-2036-channel-topic-viewer
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2036: Channel topic views for owners and admins (T-1992 follow-up)

## Spec (written by Claude, do not edit)

### Why
T-1992 (merged 2026-10-18) stopped channel subscribers from listing a channel's audience. A channel's General topic view now lists only owners and admins. But topic views carry no viewer, so **owners and admins get the narrowed list too**, and lose their own topic's people line. This task passes the viewer, so managers see everyone again. It's a permissions rule, so a test is required.

### Facts (read by the lead on 2026-10-18 at `c0f134fa7`)
- **`apps/server/src/topics/views.ts`** is 379 lines; keep it at or under 400.
  - `toTopicViews(db, rows, mucDomain)` is at `:349-353`.
  - The narrowing is at `:235-258`:
    - `channelGroupIds` comes from the `groups.kind` rows;
    - `managerIdsByGroup` holds the members with `role !== 'member'`;
    - `generalAudienceByGroup` keeps only managers for a channel group.
  - The comment at `:235-237` says that owners and admins get the same narrowed list.
- **Callers with a signed-in user:**
  - `apps/server/src/chats/list-handler.ts:165-169`, `toTopicViews(deps.db, …, deps.config.xmpp.mucDomain)` inside a handler with `user`;
  - `apps/server/src/topics/api.ts:128`, `toTopicViews(deps.db, rows, mucDomain)` inside the `list` handler with `user`.
- **Other callers:** there are about 15 call sites of `toTopicView` or `toTopicViews` in total. They keep today's narrowed behaviour, so no change is needed there.
- **The existing test.** `apps/server/src/topics/public-members.test.ts:251` calls `toTopicViews(context.db, [topic!], context.config.xmpp.domain)`.

### Steps
1. **`views.ts`.** Add an optional last parameter, `viewerId?: string`, to `toTopicViews`, and pass it to wherever `generalAudienceByGroup` is built. For a channel group where `viewerId` is in that group's `managerIdsByGroup`, use the full member list; otherwise keep today's managers-only list. Update the `:235-237` comment. The file stays at or under 400 lines; if it would go over, move the audience map into a small helper in the same folder.
2. **The callers.** Pass `user.id` from `chats/list-handler.ts` and from `topics/api.ts` (the topics `list` route). Leave other callers unchanged.
3. **The test.** Add a case in `apps/server/src/topics/public-members.test.ts`, following its style, for one channel:
   - for a subscriber, the General view lists only managers;
   - for an owner or admin viewer, it lists everyone, subscribers included.

### Allowed files
- `apps/server/src/topics/views.ts`
- `apps/server/src/chats/list-handler.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/topics/public-members.test.ts`
- `work/T-2036-channel-topic-viewer.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/public-members.test.ts --reporter=dot
pnpm gate
```

### Acceptance
The test passes, and the gate passes, including the server build.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/topics/views.ts`: added an optional last parameter `viewerId?: string` to `toTopicViews` and to its private helper `loadTopicViewParts`. The General-topic audience map now narrows a channel to managers only unless the viewer is in that group's `managerIdsByGroup`; owners and admins get the full member list, while a missing viewer or a plain member keeps today's T-1992 behaviour. Updated the T-1992 comment. File is 385 lines.
- `apps/server/src/topics/api.ts`: the topics `list` handler passes `user.id`.
- `apps/server/src/chats/list-handler.ts`: the chat list passes `user.id`.
- `apps/server/src/topics/public-members.test.ts`: added a case for a channel General topic: a subscriber sees only owner and admin (memberCount 2), while both the owner and the admin see all three members (memberCount 3). Also reworded the old comment in the T-1992 test, whose assertion now reads as the no-viewer default.
- Other `toTopicView` / `toTopicViews` callers were left unchanged, so they keep the narrowed list.

### Checks run
- `pnpm install`: done, 15.1s, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-members.test.ts`: 1 file passed, 7 tests passed.
- `pnpm gate` (first run): GATE FAIL on `format` for `apps/server/src/topics/views.ts`; fixed with `pnpm exec prettier --write` on that file only.
- `pnpm gate` (final run) summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (8.0s)
  PASS  effect  (1.2s)
  PASS  build @zilar/server  (0.8s)
  PASS  tests @zilar/server  (63.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No deviations from the spec. No new dependencies, no migrations, no routes.
- Permissions: the viewer check is a membership lookup on the same `group_members` rows already loaded for the view, and only widens the result for non-members with `role !== 'member'`; nothing is exposed to a caller who is not a manager of that channel.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.** `toTopicViews` takes an optional `viewerId`. In a channel, a viewer who is a manager (role not `member`) sees the full General audience, and anyone else, or no viewer, keeps the managers-only list.
- **Callers.** The chat list and the topics list routes pass `user.id`; the other callers keep the narrowed default.
- **Tests.** The new test covers a subscriber and an owner.
- **Size.** `views.ts` is 385 lines, under 400.
