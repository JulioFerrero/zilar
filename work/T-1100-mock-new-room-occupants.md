---
id: T-1100
title: "Mock XMPP: a room with no posts takes its occupants from its group's members, not every seeded person (new topic showed '9 members, 9 online' in a 2-member group)"
status: todo
milestone: M5
branch: task/T-1100-mock-new-room-occupants
model: auto
effort: default
depends_on: [T-1099]
estimate: 0.1 day
---

# T-1100: New mock rooms get their group's members as occupants

## Spec (written by Claude, do not edit)

### Why
**What the lead saw, 2026-10-11** (T-1099 check, `?mock=1`): a topic newly created in Familia, a 2-member group, has the header "9 members, 9 online".

**What the lead read:**
- `packages/client-core/src/store/incoming.ts:225-226` sets `onlineCount` from the room's occupant event, and `memberCount` to `max(memberCount, occupants.length)`.
- The fake XMPP emits `occupantList(data, roomJid, nick)` on join (`packages/mock-backend/src/xmpp/core.ts:137`).
- `seededMembers` (`packages/mock-backend/src/xmpp/rooms.ts:8-24`) takes the room's members from the people who posted in it. When nobody has posted (a new room), `:16-22` falls back to **every** seeded person.
- `rooms.ts` is the only cause. Real ejabberd reports only the actual occupants, so this is mock-only.

### What to build
1. **Change the fallback in `seededMembers`** (`rooms.ts:16-22`). When the room has no posts:
   - find the topic whose `chatJid` is `roomJid` in `data.topics`, then its group in `data.groups`;
   - use that group's members, mapped to their bare JIDs through `data.people`, without the viewer.
   - Read `packages/mock-backend/src/domains/groups/state.ts`, `packages/mock-backend/src/domains/topics/state.ts` and `packages/mock-backend/src/state.ts` for the field names.
   - Keep the old fallback (every person) only when no topic or group matches.
2. **The comment** at `rooms.ts:1-3` says the same.
3. **The Report:** a throwaway probe against `createMockBackend()`, not committed:
   - `occupantList` for a new topic created in `g-familia` (through `POST /api/groups/:groupId/topics` with `g-familia`) gives the viewer plus Familia's other members only;
   - `occupantList` for `dev-team@rooms.zilar.test` is unchanged from main.

   Print both lists before and after.
4. **No tests,** and no other files change.

### Read first
`AGENTS.md`, `packages/mock-backend/src/xmpp/rooms.ts`, and the state files named above.

### Allowed files
`packages/mock-backend/src/xmpp/rooms.ts`, `work/T-1100-mock-new-room-occupants.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe from step 3.

---

## Report (written by the worker when done)

## Review (written by Claude)
