---
id: T-2222
title: "Phone groups API on the shared client-core groups API: one createGroup (group or channel, public handle) for both apps; the phone's hand-written GroupsApi wrapper goes"
status: merged
milestone: M5
branch: task/T-2222-phone-groups-api-shared
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2222: Phone groups API on the shared one

## Spec (written by Claude, do not edit)

### Why
Big-cut plan "hand-written API wrappers" (`docs/audit/big-cut-plan.md`). `apps/mobile/src/lib/groups-api.ts` (123 lines) re-wraps every call of the shared `makeGroupsApi` (`packages/client-core/src/groups-api.ts:27`). Its 50-line hand-written `GroupsApi` interface only turns results into `Promise<void>`. The web builds its own `createGroup` (`apps/web/src/lib/api/groups.ts:54-73`) and the phone builds `createGroup` and `createChannel` (`groups-api.ts:66-92`): three copies of one create call.

### Facts (read by the lead on 2026-10-19)
1. **Phone wiring.** `apps/mobile/src/lib/groups-api.ts` exports `ChannelMemberRole`, `GroupsApi` and `makeGroupsApi(call)`. Its users are:
   - `apps/mobile/src/store/effects/ports.ts:19,155,182,279`;
   - `apps/mobile/src/store/chat-store-provider.tsx:19,140`;
   - the calls in `apps/mobile/src/store/effects/group-actions.ts` and `apps/mobile/src/store/effects/groups.ts`.
2. **Phone-only behaviour to keep:**
   - `listGroupMembers` maps `roles: member.roles ?? []`, because `roles` is optional in the contract (`packages/api-contract/src/groups.ts:88`);
   - `patchGroupSettings` sends `omitUndefined(patch)`;
   - `createChannel` drops a blank description;
   - public visibility is sent only with a handle.
3. **Web wiring.** The web `createGroup` spreads `omitUndefined(input)`, trims the title and description, and is called through the store port (`apps/web/src/store/effects/portTypes.ts:50`, `groupCreate.ts:90,121`).

### Steps
1. **One shared create call.** Add `createGroup(input: { title; memberIds?; kind?: 'group' | 'channel'; description?; visibility?: 'public'; handle? }): Promise<GroupDetail>` to `makeGroupsApi` in `packages/client-core/src/groups-api.ts`:
   - trim the title;
   - send `description` trimmed and only when it is not blank;
   - send `visibility: 'public'` and `handle` only when both are set;
   - send `memberIds` and `kind` only when set.

   Add `patchGroupSettings(groupId, patch)` there too, with `omitUndefined`.
2. **Web.** `apps/web/src/lib/api/groups.ts` re-exports the shared `createGroup`, and its own copy goes. Web behaviour is unchanged.
3. **Phone.** Delete `apps/mobile/src/lib/groups-api.ts`:
   - The phone uses the shared `makeGroupsApi` directly; `ports.ts` types `groups` as `ReturnType<typeof makeGroupsApi>`.
   - `createChannel` callers call `createGroup({ ..., kind: 'channel' })`.
   - Move the `roles ?? []` mapping to the one place in the phone store that reads members.
   - `ChannelMemberRole` moves to where it is used, or is replaced by the contract's role type.
4. **No behaviour change on either app.** Every "why" comment of the deleted file that still applies moves next to its code.
5. **Stop rule:** the net (`git diff --numstat` over `apps` and `packages`) must be at least −60. If it is not, stop and say why in the Report.

### Allowed files
- `packages/client-core/src/groups-api.ts`
- `apps/web/src/lib/api/groups.ts`
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `apps/mobile/src/store/chat-store-provider.tsx`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `work/T-2222-phone-groups-api-shared.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; no new tests.
- Net at least −60.
- The lead checks on the phone emulator (mock): create a group, create a channel, open the members list.
- The lead checks the same on web mock: create a group.

---

## Report (written by the worker when done)

**Status:** done, awaiting review.

### What I did
- `packages/client-core/src/groups-api.ts`: added `createGroup(input)` (trims the title, sends a trimmed non-blank description, sends `memberIds`/`kind` only when set, sends `visibility: 'public'` plus `handle` only when both are set) and `patchGroupSettings` (with `omitUndefined`). Both return the shared `GroupDetail`/`void`.
- `apps/web/src/lib/api/groups.ts`: deleted the local `createGroup`; `createGroup` now comes from the shared `makeGroupsApi` destructure. The remaining web-only calls are untouched.
- `apps/mobile/src/lib/groups-api.ts`: deleted.
- `apps/mobile/src/store/effects/ports.ts`: types `groups` (`RealStoreDeps.groupsApi`, `PortsShape.groups`, `PortsTest`) as `ReturnType<typeof makeGroupsApi>` and builds it from `@zilar/client-core`.
- `apps/mobile/src/store/chat-store-provider.tsx`: imports `makeGroupsApi` from `@zilar/client-core`.
- `apps/mobile/src/store/effects/group-actions.ts`: `createChannel` calls `createGroup({ ..., kind: 'channel' })`; `listChannelMembers` now does the `roles: member.roles ?? []` mapping (the same shape the deleted wrapper produced); `ChannelMemberRole` is replaced by the inline `'admin' | 'member'` union.
- `apps/mobile/src/store/effects/groups.ts`: `GroupWrite` accepts a `Promise<unknown>` call and drops the fresh detail before the reload (comment moved from the deleted wrapper); every store call keeps its `Promise<void>` contract.

### Commands run
- `pnpm install`: done in 19.1s.
- No single test file was relevant to these files, so none was run separately.
- `pnpm gate` (from the repo root): **GATE PASS**
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/client-core  (1.7s)
  PASS  tests @zilar/mobile  (4.7s)
  PASS  tests @zilar/web  (4.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Size
`git diff --numstat -- apps packages`: added 66, deleted 154, **net −88** (the stop rule needs at least −60).

### Deviations from the spec
- The shared `CreateGroupInput.visibility` is typed `'private' | 'public'` instead of only `'public'`. The web `ApiClient` port (`apps/web/src/store/effects/portTypes.ts`, outside my Allowed files) already declares `'private' | 'public'`, and with `exactOptionalPropertyTypes` a `'public'`-only parameter fails typecheck at that assignment. The call still sends `visibility: 'public'` and `handle` only together; a `'private'` value is omitted (private is the server default), and no caller in either app passes it. Behaviour for every existing caller is unchanged.
- The web used to send a defined-but-blank description as `''`; the shared call now omits a blank description, as step 1 requires. No web caller reaches it with a blank description (`NewGroupDialog` and `groupCreate.ts` drop it before the call).

### Open questions
None.


## Review (written by Claude)

Approved; the pre-review was clean. Two nits: `visibility` is typed `'private' | 'public'`, and the phone store still pre-shapes the description and visibility before the shared call (harmless, but double). Net −88.

**What changed:**
- One `createGroup` (group or channel, trimmed title and description, a public handle only when both are set) plus `patchGroupSettings` live in client-core `groups-api.ts`.
- The web re-exports `createGroup`.
- The phone's hand-written `lib/groups-api.ts` (123 lines) is gone: the store uses the shared API, and the `roles ?? []` mapping now sits in the member load.

**Comments:** the deleted interface comments restated server rules. The `channel_needs_admin` notes stay at the phone call sites, and the "never cleared" patch note moved with `patchGroupSettings`.

**Lead checks:**
- Web mock: created a group (Ana) and a channel, both listed, no page errors.
- Phone emulator (mock): the smoke passes; Dev team info shows 6 members; People and AIs lists members with role tags; a new group (Ana) opens with "2 members, 1 topic"; a new channel opens with "1 subscriber"; both are in the chat list.
