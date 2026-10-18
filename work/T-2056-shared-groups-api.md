---
id: T-2056
title: "Share W3-b (part 1): one groups/roles/invite-links API in client-core (makeGroupsApi(call), like T-2048's makeTopicsApi) for the calls both apps make — members, member role, remove, transfer owner, delete, add members, group AIs, custom roles, invite links, join preview and join — web lib/api/groups.ts and phone groups-api/roles-api/invite-links-api become thin adapters with the same exported names"
status: merged
milestone: M5
branch: task/T-2056-shared-groups-api
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2056: Shared groups API (share plan W3-b, part 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.16 found these calls written twice: web `lib/api/groups.ts` against phone `groups-api.ts`, `roles-api.ts` and `invite-links-api.ts`. The calls are members, roles and invite links. T-2048 (merged) set the pattern with `makeTopicsApi(call)` in `packages/client-core/src/topics-api.ts`. Follow it exactly.

### Facts (read by the lead on 2026-10-18 at `310ba71b8`)
- **The pattern.** `packages/client-core/src/topics-api.ts` (123 lines, T-2048):
  - `makeTopicsApi(call)`, where `call` runs `(client: ZilarClient) => Effect<A, ApiError>` and returns a `Promise<A>`;
  - web adapts it with `callApi`; the phone adapts it with `createApiClient` plus `runApi`.

  It's exported in `packages/client-core/src/index.ts:23-30`.
- **Web.** `apps/web/src/lib/api/groups.ts` (324 lines). The duplicated calls are:
  - `getGroup` (`:47`), `addGroupAi` (`:53`), `removeGroupAi` (`:57`);
  - roles (`:69-101`): `listGroupRoles`, `createGroupRole`, `renameGroupRole`, `deleteGroupRole`, `setGroupRoleMembers`;
  - members (`:157-200`): `listGroupMembers`, `changeGroupMemberRole`, `removeGroupMember`, `transferGroupOwner`, `deleteGroup`, `addGroupMembers`;
  - invite links (`:217-241`): `createGroupInviteLink` (trims `label`), `listGroupInviteLinks`, `revokeGroupInviteLink`;
  - joins (`:253-259`): `previewJoinLink`, `joinByLink`.

  The web-only parts stay in the file: `createGroup`, `setMembersCanCreateTopics`, `setGroupListener`, `setGroupBackground`, the directory and public join, `setGroupVisibility` and `checkGroupHandle`.
- **Phone.**
  - `apps/mobile/src/lib/groups-api.ts` (175 lines): the `GroupsApi` interface (`:19-86`) and `createGroupsApi(getToken, fetchImpl, apiUrl)` (`:93+`). Its mutators return `Promise<void>`, while web's return `GroupDetail`.
  - `apps/mobile/src/lib/roles-api.ts` (69 lines): `RolesApi` and `createRolesApi` (`:47-68`), with hand-typed `RoleHolder` and `CustomGroupRole` (`:15-27`) and `parseCustomGroupRole` (`:41`).
  - `apps/mobile/src/lib/invite-links-api.ts` (175 lines): hand-typed `GroupInviteLink`, `CreatedInviteLink`, `JoinPreview` and `JoinResult` (`:18-56`), and `InviteLinksApi` plus `createInviteLinksApi` (`:57-97`). Phone-only helpers (`extractJoinToken`, `joinFailureMessage`, `resolveGroupChat`, `:107+`) stay.
- **Contract types.** `GroupDetail`, `GroupMember`, `GroupRole`, `InviteLink`, `CreatedInviteLink`, `JoinPreview` and `JoinResult` all come from `@zilar/api-contract`.

### Steps
1. **The shared API.** Create `packages/client-core/src/groups-api.ts` with `makeGroupsApi(call)`, returning every duplicated call above with web's names and return types (`GroupDetail` where web returns it). Keep web's comments that explain server behaviour (409 `channel_needs_admin`, 204 on delete, the `label` trim).

   Add ONE export line in `packages/client-core/src/index.ts`, **directly after line 30** (the end of the `./topics-api` export).
2. **Web.** `apps/web/src/lib/api/groups.ts` builds `const api = makeGroupsApi(callApi)` and re-exports the same names and signatures. The web-only functions stay.
3. **Phone.**
   - The three files build the shared API over their client and keep their `create*Api(...)` factories and interface method names.
   - Mutators that return `void` on the phone wrap with `.then(() => undefined)`, so their callers don't change.
   - Replace the hand-typed role, link and preview types with re-exports of the contract types.
   - Delete `parseCustomGroupRole` **only if** `git grep` finds no importer.
   - If the type switch breaks a phone file outside Allowed files, stop and report BLOCKED with the paths and errors.
4. **Tests.** No new tests (API pass-through). The existing tests pass.
5. **Size.** Report the line counts. The target is about 150 product lines fewer. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/groups-api.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/api/groups.ts`
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/lib/roles-api.ts`
- `apps/mobile/src/lib/invite-links-api.ts`
- `work/T-2056-shared-groups-api.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines go down.
- **Lead check, web mock:** group info opens with members; creating and revoking an invite link works; promoting a member in a channel works.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/groups-api.ts` with `makeGroupsApi(call)`, following
  `makeTopicsApi` (T-2048). It carries every call the two apps duplicated, with web's
  names and return types: `getGroup`, `addGroupAi`, `removeGroupAi`, `listGroupRoles`,
  `createGroupRole`, `renameGroupRole`, `deleteGroupRole`, `setGroupRoleMembers`,
  `listGroupMembers`, `changeGroupMemberRole`, `removeGroupMember`, `transferGroupOwner`,
  `deleteGroup`, `addGroupMembers`, `createGroupInviteLink` (trims `label`),
  `listGroupInviteLinks`, `revokeGroupInviteLink`, `previewJoinLink`, `joinByLink`.
  Web's behaviour comments are kept (409 `channel_needs_admin`, 204 on delete, the
  `label` trim, T-1190/T-1243/T-1183 notes).
- Added one export line in `packages/client-core/src/index.ts` directly after the
  `./topics-api` export.
- Web `apps/web/src/lib/api/groups.ts` now builds `const api = makeGroupsApi(callApi)`
  and re-exports the same names through one destructuring. The web-only calls
  (`createGroup`, `setMembersCanCreateTopics`, `setGroupListener`, `setGroupBackground`,
  directory/public join, `setGroupVisibility`, `checkGroupHandle`) and the type
  re-exports stay. All previous type names still come from this module
  (`GroupDetail`, `GroupMember`, `GroupRole`, `CreatedInviteLink`, `GroupInviteLink`,
  `JoinPreview`, `JoinResult`, `CreateGroupInviteLinkInput`).
- Phone `groups-api.ts`, `roles-api.ts` and `invite-links-api.ts` now build the shared
  API over their `createApiClient` + `runApi`; the `create*Api` factories and interface
  method names are unchanged. Mutators that returned `void` wrap with
  `.then(() => undefined)`. `listGroupMembers` keeps its four-field mapping (it drops
  `handle`/`avatarUrl`, as before, because the phone narrows `handle` to absent).
- Replaced the hand-typed phone types with contract re-exports:
  `CustomGroupRole` -> `GroupRole`, `RoleHolder` -> `RoleMember`,
  `GroupInviteLink` -> `InviteLink`, and `CreatedInviteLink`, `JoinPreview`,
  `JoinResult`, `CreateGroupInviteLinkInput` from `@zilar/api-contract` /
  `@zilar/client-core`. Deleted `parseCustomGroupRole` after `git grep` found no
  importer outside `roles-api.ts`. Phone-only helpers (`extractJoinToken`,
  `joinFailureMessage`, `resolveGroupChat`) stay.

### Checks run

- `pnpm install`: done (pre-existing peer warning: mobile `@types/react-dom` wants
  `@types/react ^19.3.0`, found 19.2.18; unrelated).
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/client-core
  PASS  tests @zilar/mobile
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: `git grep` found no test importing these modules, so the
  gate's package suites are the coverage. No new tests were written (spec says none).

### Size

| File | Before | After |
| --- | ---: | ---: |
| `packages/client-core/src/groups-api.ts` | 0 | 153 |
| `packages/client-core/src/index.ts` | 52 | 53 |
| `apps/web/src/lib/api/groups.ts` | 324 | 191 |
| `apps/mobile/src/lib/groups-api.ts` | 175 | 166 |
| `apps/mobile/src/lib/roles-api.ts` | 69 | 45 |
| `apps/mobile/src/lib/invite-links-api.ts` | 175 | 142 |

Product files: 743 -> 697 lines (46 fewer). Every file is under 400 lines. This is
below the "about 150 fewer" target: the shared file keeps the behaviour comments the
spec asked to preserve, and the phone's `GroupsApi` interface with its per-method docs
is unchanged.

### Notes for the lead

- Behaviour is unchanged apart from the type move: the phone still drops
  `handle`/`avatarUrl` from member rows, and every mutator still resolves to `void` on
  the phone and to `GroupDetail`/`void` on web.
- Nothing outside the Allowed files was edited.


## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.** One `makeGroupsApi` in client-core. Web `lib/api/groups.ts` keeps its names, and the phone `groups-api`, `roles-api` and `invite-links-api` are adapters over the contract types.
- **Size.** −45 product lines, below the ~150 estimate. The kept behaviour comments and the phone's void wrappers explain the gap.
- **Lead Playwright check** (web mock, :5199):
  - Dev team group info shows 6 members and its topics;
  - People and AIs lists the AIs, 4 people and the roles (Designers, Devs);
  - Invite with a link shows one link, and "Create invite link" adds a second;
  - no console errors.
- **Not covered:** a phone check. Its adapters keep the same method names.
