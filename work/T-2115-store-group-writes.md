---
id: T-2115
title: "Store phase 2, T3: one group write-then-reload path (web groupSettings wrappers and phone group-membership/settings helpers) plus the topic failure hook — one shared copy in packages/client-core/src/store, both apps call it"
status: merged
milestone: M5
branch: task/T-2115-store-group-writes
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2115: Store phase 2, T3

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and web and phone share code. T-2112 read both stores and wrote the plan: `docs/audit/store-phase2-plan.md`.

### What to do
Do **task T3** exactly as the plan describes it, in section "2. Tasks", heading "### T3". The section gives the core function to add, the web and phone lines that shrink or go (`file:line`), and the tests that cover them.

Read the inventory section for your area (section 1) first. The lead accepted the plan's section 5 decisions:
- apply the returned detail when the route answers `GroupDetail`, and reload when it answers `void`;
- the role and invite wrappers stay.

Rules:
1. **Behaviour stays the same** on web and phone, except where the plan names a fix.
2. **Out of scope:** the message hot path (send, ledger, incoming). Do not touch it.
3. **Line numbers.** The plan's line numbers were read at `c0af99b3b`, and later merges may have moved them. Re-read each place before you edit it.
4. **Tests.** No new tests. Run the tests the plan names (`--reporter=dot`), then `pnpm gate`.
5. **Report** the line counts: web, phone, core and net.

### Allowed files
- `packages/client-core/src/store/group-actions.ts`
- `apps/web/src/store/effects/groupSettings.ts`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/group-membership-actions.ts`
- `apps/mobile/src/store/effects/group-settings-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/group-actions.test.ts`
- `work/T-2115-store-group-writes.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 120 lower.
- **Lead check:** web mock: in Group info of Dev team, rename the group, change a member's role, and leave a topic; in a channel's info, change a setting. Each change shows at once and survives a reload of the panel. Phone emulator: group info and channel info open and show their members.

---

## Report (written by the worker when done)

### What I did

- **Core** (`packages/client-core/src/store/group-actions.ts`): added `changeGroupForGroup` + `GroupIdChangeStore` for screens keyed by a group id, built on one private `groupWrite` sequence now shared with `changeGroup` (call, apply the returned detail, optional reload, optional list refresh). Added an optional trailing `onFailure` effect to `changeTopic`, run on any cause (error or defect) before the cause is rethrown.
- **Web** (`apps/web/src/store/effects/groupSettings.ts`): one local `changeGroup` helper builds the store adapter, and the ten `GroupDetail` routes are one call each. `leaveChannel` lost an `Effect.gen` wrapper; `joinPublicGroup` was already a core call and stays.
- **Phone** (`apps/mobile/src/store/effects/groups.ts`, `group-actions.ts`): one `writeGroup` helper calls the core group-id path with `reloadDetail` (phone routes answer `void`), used by add/remove member and AI, `patchGroupSettings`, owner transfer, role change and channel role. The duplicated membership/settings factories collapsed into one. `removeTopicMember` now uses the core `changeTopic` failure hook instead of `failAfter`.
- Behaviour kept: detail routes apply the answer, void routes re-read once, list refresh rules unchanged. Role and invite wrappers stayed as they were. No hot-path file touched. No new tests.

Line counts (before → after):
- web: 217 → 137 (**−80**)
- phone: 648 → 598 (**−50**; `groups.ts` 347 → 326, `group-actions.ts` 301 → 272)
- core: 246 → 299 (**+53**)
- net: **−77**, product lines **−130**

### Checks run

- `pnpm install --frozen-lockfile`: done in 25.5s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot store/effects/group-actions.test.ts`: 1 file, 3 tests passed (run twice, before and after the final edit).
- `pnpm gate`: final run passed. Two earlier runs failed and were fixed: format asked for Prettier on the three edited source files, and typecheck rejected `Effect.catchAllCause` (Effect 4 names it `catchCause`).

Final gate summary:
```
PASS  install (frozen)  (1.2s)
PASS  format  (1.4s)
PASS  lint  (1.2s)
PASS  typecheck  (7.5s)
PASS  effect  (0.8s)
PASS  build @zilar/server  (0.4s)
PASS  tests @zilar/client-core  (8.5s)
PASS  tests @zilar/mobile  (5.0s)
PASS  tests @zilar/web  (5.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- The plan's two phone files `group-membership-actions.ts` and `group-settings-actions.ts` no longer exist at this base: T-2113 merged them into `groups.ts` (the plan's line numbers also moved). I removed their repeated sequences from `groups.ts` instead of deleting files.
- `deleteGroup` stayed as it was (call + refresh list). It is one of the lines the plan names, but the route deletes the group, so re-reading the detail through the shared path would 404; a helper with no detail and no reload would have been longer than the current code.
- Phone routes are `Promise<void>` because `apps/mobile/src/lib/groups-api.ts` narrows the contract's detail away; that file is outside the Allowed files, so the shared path reloads for phone and applies the detail for web, as decided in section 5.
- `changeGroupForGroup` treats an empty group id as not available. For membership/settings this turns a malformed screen state into the existing fixed sentence instead of a request with `''`; normal paths are unchanged.
- I did not run the web mock or phone emulator checks; those are the lead's.

## Review (written by Claude)

Approved; the pre-review was clean (2 nits). Net −77 (−130 product lines in the apps, +53 in core). That is under the −120 target. The two phone helper files the plan expected to delete had already gone in earlier work; the plan counted from an older base.
- **Web mock** (`:5245`, main side by side on `:5233`; identical on both):
  - Joining "Ideas" moves it to YOUR TOPICS.
  - In group settings, "Members can create topics" switches false → true.
  - No page errors.
- **Phone emulator:** the smoke passed (`/group-info/g-devteam`, `/chat/acme@rooms.zilar.test`, `/group/g-devteam`).
- **Follow-up, not this task:** "Make admin" fails in mock mode on both platforms, and fails the same way on main ("Group not found" toast on web, "Could not change the member role." on phone). It is an old mock gap, to be looked at in a later mock task.
