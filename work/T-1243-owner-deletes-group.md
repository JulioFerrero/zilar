---
id: T-1243
title: "TG-7 groups (SG-4 part 2): the owner can delete a group — DELETE /api/groups/:id destroys every topic room and deletes the group rows (all child tables cascade); members' apps drop the chat at once on the room-destroyed presence; web Group panel gets Delete group (owner only, typed-name confirm)"
status: merged
milestone: M5
branch: task/T-1243-owner-deletes-group
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1243: The owner deletes a group

## Spec (written by Claude, do not edit)

### Why
It's item 7 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4) and SG-4 (`docs/audit/social-graph-audit.md`, plan row 4). Owner transfer exists (T-1187: `transferGroupOwner`, `apps/server/src/groups/ownership.ts:35`; web "Make owner", `apps/web/src/components/GroupMembersSection.tsx:98-201`), but nobody can delete a group.
- **Data:** every table that points at `groups` cascades on delete: `group_members`, `topics`, `group_ais`, `group_invite_links`, `handles`, roles, routines, approvals and more (grep `REFERENCES "public"."groups"` in `apps/server/drizzle/*.sql`).
- **Rooms:** each topic is its own MUC room (`topics.room_localpart`; General shares the group's `room_localpart`, `apps/server/drizzle/0019_general-topics.sql`). `adminClient.destroyRoom` exists (`apps/server/src/xmpp/admin/client.ts:257-260`), with a best-effort wrapper `destroyQuietly` (`apps/server/src/groups/queries.ts:332-342`).
- **Clients:** they drop a chat at once on a kick, ban or affiliation change (`packages/xmpp-core/src/core-effect/presence.ts:76-87`, codes from `packages/xmpp-core/src/stanza/parse-presence.ts:62-71`), but XEP-0045 room destruction sends an unavailable self-presence with a `<destroy/>` child in the `muc#user` `<x/>`, which isn't handled.

### What to build
1. **Contract** (`packages/api-contract/src/groups.ts`, next to `transferOwner`, `:186`): a `deleteGroup` DELETE endpoint on `/groups/:id`, answering 204.
2. **Server:** `deleteGroup` in `apps/server/src/groups/ownership.ts`, wired in `apps/server/src/groups/api.ts` next to `transferOwner` (`:214-230`). Keep `api.ts` at most 400 lines (it's 370); if it doesn't fit, wire it through a helper.
   - **Owner only** (the same role check `transferGroupOwner` uses; cite it). A member or admin gets 403, and an unknown or invisible group gets 404.
   - **Order:**
     1. read every `topics.room_localpart` of the group;
     2. `DELETE FROM groups WHERE id = …` in one transaction (the cascade does the rest);
     3. after the commit, `destroyRoom` for each room, best effort (warn and continue, as `destroyQuietly` does);
     4. then delete the `chat_prefs`, `chat_reads` and `chat_deliveries` rows whose `chat_jid` is one of those room JIDs (no FK; cite the JID builder).
   - Write one audit entry with ids only (the group id and room count), plus the existing write rate limit for group writes (cite it).
3. **Clients** (`parse-presence.ts` and `core-effect/presence.ts`): when my own unavailable self-presence (status 110, or my nick as today) carries `<destroy/>` in the `muc#user` `<x/>`, emit the same `removed` event. Add `destroyed?: true` to the parsed presence (types in `packages/xmpp-core/src/types.ts`).
4. **Web:** in `GroupMembersSection.tsx` (317 lines, keep it at most 400; or the group panel's danger zone, wherever "Leave group" lives; cite it), an owner-only "Delete group" opens an in-panel confirm that needs the group name typed. Its text: "Delete <name> for everyone? All topics and messages go away. This can't be undone." It calls the route through `apps/web/src/store/effects/groupActions.ts`. On success the chat closes and the row drops; a failure shows one line.
5. **Tests** (permissions, plus the message pipeline for the client), up to 3:
   - in `apps/server/src/groups/ownership.test.ts`: the owner deletes the group and the group, topic and member rows are gone; an admin gets 403 and nothing is deleted;
   - in `packages/xmpp-core/src/stanza.test.ts` (or `connection-resilience.test.ts` for the core event): a self-presence with `<destroy/>` emits `removed`.

### Out of scope
- Mobile UI: the next task. Mobile already gets the `removed` handling through xmpp-core.
- Deleting the room archive: ejabberd keeps it, and nobody can reach it after the room is gone.

### Read first
`AGENTS.md`, `apps/server/src/groups/ownership.ts`, `apps/server/src/groups/ownership.test.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/groups/queries.ts:300-345`, `packages/api-contract/src/groups.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `apps/web/src/components/GroupMembersSection.tsx` and `apps/web/src/store/effects/groupActions.ts`.

### Allowed files
`packages/api-contract/src/groups.ts`, `apps/server/src/groups/ownership.ts`, `apps/server/src/groups/ownership.test.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/groups/delete-group.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/**/*.test.ts`, `apps/web/src/components/GroupMembersSection.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/lib/api/**`, `packages/mock-backend/src/domains/groups/**`, `work/T-1243-owner-deletes-group.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/ownership.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's check:**
  - on the local web mock, the owner sees Delete group, and the confirm needs the name;
  - after deploy, the delete route answers 404 for an unknown group (read-only).

---

## Report (written by the worker when done)

Status: review.

### What I did
- **Contract** (`packages/api-contract/src/groups.ts`): added `deleteGroup` — `DELETE /groups/:id`, `HttpApiSchema.NoContent` (204), guarded by the existing group-write limiter `GroupsRoleRateLimit` (30/hour, `apps/server/src/groups/api.ts` `ROLE_CHANGE_RATE_LIMIT_MAX`), next to `transferOwner`.
- **Server** (`apps/server/src/groups/delete-group.ts`, new; wired in `apps/server/src/groups/api.ts`): `deleteGroup` reads every `topics.room_localpart` of the group (General is a topic row too, `groups/service.ts:160`), then in one transaction under `pg_advisory_xact_lock(hashtext('group-delete:<id>'))` reads the actor's `group_members` role: no row → 404 (`Group not found`, same as unknown), `role !== 'owner'` → 403. The `DELETE FROM groups` cascade removes members, topics, AIs, invites, handles, roles, routines, approvals. After the commit each room is destroyed best-effort via `destroyQuietly` (`queries.ts:332`), then the `chat_prefs` / `chat_reads` / `chat_deliveries` rows whose `chat_jid` is one of the room JIDs are deleted with `sql.in(...)` (no FK; JID form `${localpart}@${mucDomain}` lowercased, same as `topics/views.ts:99` and `push/candidates.ts:209`). One audit entry `group.deleted` with the group id and `roomCount` only.
- **xmpp-core**: `parseMucPresence` now reads a `<destroy/>` child of the `muc#user` `<x/>` and sets `destroyed` (`stanza/parse-presence.ts`); `core-effect/presence.ts` emits `removed` for my own unavailable self-presence carrying `<destroy/>` (status 110 or my nick, as for kicks/bans). The flag type lives in `types.ts` (`ParsedMucPresence`).
- **Web** (`GroupMembersSection.tsx`): owner-only "Delete group" opens an in-panel confirm that needs the group name typed; its sentence is "Delete <name> for everyone? All topics and messages go away. This can't be undone." On success it refreshes the chat list, closes the panel and navigates home; a failure shows one inline line. API call added in `apps/web/src/lib/api/groups.ts`.
- **Mock** (`packages/mock-backend/src/domains/groups/`): `DELETE /api/groups/:id` (owner → 204, member/admin → 403, non-member/unknown → 404) plus a `removeGroup` state mutator, so the web mock exposes the button and the confirm.

### Files changed
`packages/api-contract/src/groups.ts`, `apps/server/src/groups/delete-group.ts` (new), `apps/server/src/groups/api.ts`, `apps/server/src/groups/ownership.test.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/stanza.test.ts`, `apps/web/src/components/GroupMembersSection.tsx`, `apps/web/src/lib/api/groups.ts`, `packages/mock-backend/src/domains/groups/routes.ts`, `packages/mock-backend/src/domains/groups/state.ts`, `packages/mock-backend/src/domains/groups/tables.ts`, `work/T-1243-owner-deletes-group.md`.

### Commands and real results
- `pnpm install`: Done (13.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/ownership.test.ts`: 4 passed (2 pre-existing + 2 new for T-1243).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`: 83 passed (81 pre-existing + 2 new for T-1243).
- `pnpm gate` (from repo root):
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (1.4s)
  PASS  lint  (1.4s)
  PASS  typecheck  (9.7s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (20.6s)
  PASS  tests @zilar/web  (13.5s)
  PASS  tests @zilar/xmpp-core  (2.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations from the spec
1. **Web call path.** The spec says the component calls the route "through `apps/web/src/store/effects/groupActions.ts`". A store action needs a member on `ChatStoreState` in `apps/web/src/store/store.ts`, which is **not** in Allowed files, and `groupSettings.ts` (where the other group effects live) is not either. I therefore call the API directly from `GroupMembersSection.tsx` with the existing `apiStep`/`run` pattern, exactly as `panels/GroupRolesSection.tsx` calls `deleteGroupRole`. If the lead prefers the store action, `store.ts` and `groupSettings.ts` must join the Allowed files.
2. **Where `destroyed` is typed.** The parsed MUC presence type (`MucPresence`) lives in `packages/xmpp-core/src/stanza/parse-context.ts`, which is not in Allowed files. I added the flag as a `ParsedMucPresence = MucPresence & { destroyed?: true }` type in `types.ts` (the path the spec names) and used it in `parse-presence.ts` / `core-effect/presence.ts`. `types.ts` is now exactly 400 lines (its cap).
3. **Mock scope.** The mock's `DELETE` drops the group row; the simulated XMPP rooms belong to other mock domains (`xmpp/rooms.ts`, topics) that are out of Allowed scope, so they are not torn down on the mock. The lead's check (button visible, confirm needs the name) is covered.

### Notes
- Owner-only check is a membership read inside the transaction; a non-member answers the same 404 as an unknown group, so a group id cannot be probed.
- The new route is picked up by the `authz-sweep` 401 sweep automatically (it reads `app.routes`); no allowlist change was needed.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (3 nits, 1 follow-up).**
- **Server** (`delete-group.ts`):
  - the owner check and `DELETE FROM groups` run in one transaction, and the cascade removes topics, members, links, handles and roles;
  - after the commit, each topic room is destroyed best-effort (`destroyQuietly`), then `chat_prefs`, `chat_reads` and `chat_deliveries` are deleted by room JID;
  - a member or admin gets 403, and an unknown group 404. It's audited with ids only.
- **Clients:** an own unavailable presence carrying `<destroy/>` now emits `removed` (`parse-presence.ts`, `core-effect/presence.ts`), tested in `stanza.test.ts`.
- **Web:** `GroupMembersSection` has an owner-only Delete group with a typed-name confirm.
- **Lead's check on the local web mock found the UI unreachable:** `GroupPanel` opens only for a group chat with **no** topic (`ChatView.tsx:188-190`), but every group has a General topic, so the panel never opens. The same holds for T-1183's Leave group, Add members and Remove, and for T-1190's Make owner. The fix is T-1249 (a "Group info" entry for every group topic).
- **After deploy:** the delete route answers 404 for an unknown group (read-only).
