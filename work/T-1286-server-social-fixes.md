---
id: T-1286
title: "Server social-graph fixes: a person the owner blocked or removed can't rejoin by public join or invite link (SG-8); a failed sign-up no longer burns an invite use (SG-9); people search stops enumerating by display-name prefix (SG-7); tested"
status: todo
milestone: M5
branch: task/T-1286-server-social-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1286: Joins respect blocks, invites survive failed sign-ups, search by handle

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md`:
- **SG-8** (P2, `:109`): `joinPublicGroup` (`apps/server/src/groups/join.ts`) and `joinByInviteLink` (`apps/server/src/invite-links/join.ts`) check only visibility, link validity and the cap. A user the group owner has **blocked** can join; and since `removeGroupMember` deletes the row, a removed person can rejoin with the same link.
- **SG-9** (P2, `:145`): `databaseHooks.user.create.before` runs `consumeInvite` (`apps/server/src/auth/auth.ts`, with `uses = uses + 1` in `invites.ts`) **before** Better Auth inserts the user, so a failed insert keeps the use.
- **SG-7** (P2, `:157`): `searchUsers` (`apps/server/src/contact-requests/search.ts`) matches `lower(u.name) LIKE` prefixes over every user with a handle, so anyone can enumerate people by name.

**First recheck each finding on main** (line numbers moved). For any already fixed, say so with `file:line` and skip it.

### What to build
1. **SG-8:**
   - both joins refuse when the joiner and the group owner have a block in either direction (use the existing blocks table or helper; cite it), with the same error shape the routes use today for a refused join;
   - **removals:** if a "removed members" record exists, honour it. If none exists, **don't add a schema in this task**: say so in the Report, so the lead can plan a migration.
2. **SG-9:** consume the invite only after the user row exists (`databaseHooks.user.create.after`, or the same transaction), keeping the check that the invite is valid **before** the insert so an invalid invite still refuses sign-up. Cite both hooks.
3. **SG-7:** search matches only by handle (an exact handle, or a prefix of 3 or more characters), not by display name, and keeps the existing result shape. If the web or mobile search UI says "name", leave the UI alone: list it in the Report.
4. **Tests** (permissions and auth), up to 4, in the nearest existing test files (cite them):
   - a blocked user can't join a public group, and can't join by link;
   - a failed user insert leaves `uses` unchanged;
   - a name-only query returns nothing.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (`:32-42`, `:109-160`), `apps/server/src/groups/join.ts`, `apps/server/src/invite-links/join.ts`, `apps/server/src/auth/auth.ts`, `apps/server/src/contact-requests/search.ts` and the blocks module (find it).

### Allowed files
`apps/server/src/groups/*.ts`, `apps/server/src/invite-links/*.ts`, `apps/server/src/auth/*.ts`, `apps/server/src/contact-requests/*.ts`, `apps/server/src/blocks/*.ts`, `work/T-1286-server-social-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups src/invite-links src/auth src/contact-requests --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. No migration.

---

## Report (written by the worker when done)

## Review (written by Claude)
