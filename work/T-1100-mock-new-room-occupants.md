---
id: T-1100
title: "Mock XMPP: a room with no posts takes its occupants from its group's members, not every seeded person (new topic showed '9 members, 9 online' in a 2-member group)"
status: merged
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

### What I did
Changed the fallback in `seededMembers` (`packages/mock-backend/src/xmpp/rooms.ts`). When a room has no posts, it now finds the topic whose `chatJid` is `roomJid` in `data.topics`, then its group via `data.findGroup(topic.groupId)`, and returns the group's `members` mapped to their bare JIDs through `data.people` (member `userId` → person `id` → person `jid`), with the viewer (`data.me.jid`) excluded. The old fallback (every seeded person) runs only when `groupMembers()` returns `undefined` (no topic or group matches). The file's top comment now says this too. A small `groupMembers` helper keeps `seededMembers` readable.

### Files changed
- `packages/mock-backend/src/xmpp/rooms.ts` (the fix and its comment)
- `work/T-1100-mock-new-room-occupants.md` (status, this Report)

No other files. No tests added (spec says none).

### The probe (throwaway, not committed)
A temporary `packages/mock-backend/src/__probe__.test.ts` (deleted before the gate) called `createMockBackend({ delayMs: 0 })`, read `occupantList(data, roomJid, 'You').map((o) => o.realJid)`, created a topic with `POST /api/groups/g-familia/topics` (`{"name":"Probe"}`) and printed the created `chatJid`'s occupants.

`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__probe__.test.ts` — 1 passed.

Before the fix:

```
PROBE dev-team: ["you@zilar.test","ai-dev-1@zilar.test","ana@zilar.test","luis@zilar.test","marco@zilar.test"]

PROBE new topic chatJid: t-mock-1@rooms.zilar.test
PROBE familia new topic: ["you@zilar.test","ana@zilar.test","luis@zilar.test","marta@zilar.test","marco@zilar.test","sofia@zilar.test","ai-dev-1@zilar.test","ai-qa-1@zilar.test","ai-marketing@zilar.test"]
PROBE dev-team after: ["you@zilar.test","ai-dev-1@zilar.test","ana@zilar.test","luis@zilar.test","marco@zilar.test"]
```

After the fix (same probe):

```
PROBE dev-team: ["you@zilar.test","ai-dev-1@zilar.test","ana@zilar.test","luis@zilar.test","marco@zilar.test"]

PROBE new topic chatJid: t-mock-1@rooms.zilar.test
PROBE familia new topic: ["you@zilar.test","sofia@zilar.test"]
PROBE dev-team after: ["you@zilar.test","ai-dev-1@zilar.test","ana@zilar.test","luis@zilar.test","marco@zilar.test"]
```

A new Familia topic now reports the viewer plus Sofía (the group's other member) instead of all 9 seeded people. `dev-team@rooms.zilar.test` is unchanged: it has seeded posts, so `seededMembers` still takes them from the thread.

### Checks
`pnpm gate` (repo root), final lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (2.9s)
PASS  effect  (0.6s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single test run: `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__probe__.test.ts` — 1 passed (the throwaway probe above).

### Deviations / open questions
The spec says "use that group's members". I used `group.members` (human members) mapped through `data.people` exactly as written; I did not add the group's `ais` (e.g. `g-qa`'s QA-1), so a new topic in a group that has AIs lists the humans only. Say the word if AIs should be occupants too; today's `occupantList` before the fix included them via the every-person fallback.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **The change:** in `seededMembers`, a room with no posts takes its group's members, mapped through `data.people`, without the viewer. Every seeded person is used only when no topic or group matches.
- **The worker's probe:** a new Familia topic goes from 9 occupants to `you` plus `sofia`. `dev-team@rooms.zilar.test` is unchanged.
- **The nit, accepted:** the group's AIs are no longer occupants of a new topic. A real new topic has only the AIs added to it (they are ticked in the dialog and added after creation), so this is closer to the live app.
- **Check:** the gate passed. It is mock-only, so the lead ran no UI check.
