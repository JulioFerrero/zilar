---
id: T-0991
title: "Size split T50: apps/server/src/invite-links/service.ts (631 lines) into invite-links/{tokens,queries,join}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0991-split-server-invite-links
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0991: Split `invite-links/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/invite-links/service.ts` is 631 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #46 (task T50): `invite-links/tokens.ts`, `invite-links/queries.ts`, `invite-links/join.ts`, under `apps/server/src/`. `invite-links/service.ts` becomes the barrel.

Move the code unchanged, and skip both Dedup items, because both cross files. The token hashing and the join checks are keys and permissions code: not one line of their logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #46, and `apps/server/src/invite-links/service.ts`.

### Allowed files
`apps/server/src/invite-links/service.ts`, `apps/server/src/invite-links/tokens.ts`, `apps/server/src/invite-links/queries.ts`, `apps/server/src/invite-links/join.ts`, `work/T-0991-split-server-invite-links.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/invite-links/service.ts` (631 lines) into three moved-unchanged
modules, with the old path a pure re-export barrel, per `split-rules.md` and
`size-plan.md` §2.2 #46 (T50). Code moved verbatim: only imports changed. Both Dedup
items were skipped (they cross files: `requireGroupManager`/membership reads → §2.6,
`hashInviteToken`/`inviteTokenMatches` → §2.7), so that code stays put.

- `tokens.ts`: constants + `@zilar/api-contract` re-exports, `GroupInviteLinkRow`
  re-export, `InviteLinkView`/`JoinPreview`, `INVALID_LINK`/`toInvalidLink`, the token
  primitives (`generateInviteToken`, `hashInviteToken`, `inviteTokenMatches`,
  `tokenHintFor`, `toInviteLinkView`), the deps/input interfaces, and `joinUrlFor`.
- `queries.ts`: `serviceNow`, `requireGroupManager`, usability predicates
  (`linkIsUsable` + private `linkIsExpired`/`linkIsExhausted`), the link reads and
  writes (`createInviteLink`, `listInviteLinks`, `revokeInviteLink`), and the row
  helpers `findLinkRow`/`countGroupMembers`/`isGroupMember`.
- `join.ts`: `previewInviteLink`, `JoinByLinkResult`, `joinByInviteLink`,
  `assertGroupHasRoom`, `claimLinkUse`, `syncPublicTopicsByLink`.
- `service.ts`: the barrel. Explicit named re-exports only, so the internal helpers
  newly exported for the moved callers (`serviceNow`, `findLinkRow`,
  `countGroupMembers`, `isGroupMember`) do not change the public surface.

`groups/join.ts` and `invite-links.test.ts` import only via this path and were not
edited.

### Files changed

- `apps/server/src/invite-links/service.ts` (barrel)
- `apps/server/src/invite-links/tokens.ts` (new)
- `apps/server/src/invite-links/queries.ts` (new)
- `apps/server/src/invite-links/join.ts` (new)
- `work/T-0991-split-server-invite-links.md`

### Sizes (`wc -l`)

- old `apps/server/src/invite-links/service.ts`: 631
- new `apps/server/src/invite-links/service.ts` (barrel): 44
- `tokens.ts`: 145
- `queries.ts`: 242
- `join.ts`: 273

Every file is at most 400 lines; no `max-lines` warning.

### Export diff (`grep -E "^export"`)

Old public API (34 names): values `INVITE_LINK_TOKEN_BYTES`; the 5 contract constants
`INVITE_LINK_CREATE_MAX_EXPIRY_HOURS`, `INVITE_LINK_CREATE_MAX_USES`,
`INVITE_LINK_LABEL_MAX`, `INVITE_LINK_MIN_EXPIRY_HOURS`, `INVITE_LINK_MIN_MAX_USES`;
`MAX_ACTIVE_INVITE_LINKS`; `JOIN_RATE_LIMIT_MAX_PER_USER`, `JOIN_RATE_LIMIT_MAX_PER_IP`,
`JOIN_RATE_LIMIT_WINDOW_MS`, `JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER`,
`JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS`; `INVALID_LINK`, `toInvalidLink`,
`generateInviteToken`, `hashInviteToken`, `inviteTokenMatches`, `tokenHintFor`,
`toInviteLinkView`, `linkIsUsable`, `createInviteLink`, `listInviteLinks`,
`revokeInviteLink`, `previewInviteLink`, `joinByInviteLink`, `assertGroupHasRoom`,
`syncPublicTopicsByLink`, `joinUrlFor`; types `GroupInviteLinkRow`, `InviteLinkView`,
`JoinPreview`, `InviteLinkServiceDeps`, `CreateInviteLinkInput`, `CreatedInviteLink`,
`JoinByLinkResult`.

After: the barrel re-exports the identical 34 names with the same kinds — the 20 token
values plus 6 type names from `./tokens`, `linkIsUsable`/`createInviteLink`/
`listInviteLinks`/`revokeInviteLink` from `./queries`, and `previewInviteLink`/
`joinByInviteLink`/`assertGroupHasRoom`/`syncPublicTopicsByLink` plus type
`JoinByLinkResult` from `./join`. No name was added, removed or changed from value to
type.

### Deviations from the plan's line ranges (all inside the entry's named modules)

1. `joinUrlFor` was moved to `tokens.ts` instead of staying in the `join.ts` range.
   `createInviteLink` (a query) builds the URL with it, so leaving it in `join.ts`
   would make `queries.ts` import `join.ts` while `join.ts` imports `queries.ts` — a
   cycle. `tokens.ts` is the leaf module, so the helper lives there. Its body is
   unchanged. (Same shape as the T-0961 `mapXmppError` move.)
2. `serviceNow` and `requireGroupManager` (the skipped Dedup target) live in
   `queries.ts`, which holds every caller; `join.ts` imports `serviceNow` from there.
3. The deps/input interfaces (`InviteLinkServiceDeps`, `CreateInviteLinkInput`,
   `CreatedInviteLink`) and the contract re-export block live in `tokens.ts`; the plan
   leaves them uncovered, and the barrel must not hold them (import cycle).

### Effect ratchet (split-rules item 6)

`tokens.ts` carries `// effect-plain: moved unchanged from
apps/server/src/invite-links/service.ts (size split)` as line 1: it holds the
`node:crypto` code moved unchanged and has no `effect` value import, so it would
otherwise classify `needs-effect`. `queries.ts` and `join.ts` import `effect` as a
value, so they classify `effect` and need no marker (the gate's `PASS effect`
confirms it). The marker is the only one added.

### Commands and results

- `pnpm install`: done, ~43s, no errors.
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts`
  → 1 file passed, 21 tests passed.
- `pnpm gate` (from the repo root), after fixing one `prettier` wrap in
  `service.ts`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (17.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed only the `format` step on the barrel; I ran
  `prettier --write` on my one file and re-ran, after which it passed. The 5 changed
  files are exactly the 4 `invite-links` files plus this task file.

### Blocked / needs a decision

None.

### Open questions

None. If the lead would rather keep `joinUrlFor` in `join.ts` and accept the
`queries ↔ join` import cycle, that is a small change back; I chose the acyclic
layout that matches the T-0961 precedent.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `invite-links/service.ts` (631 lines) becomes the barrel plus `tokens`, `queries` (242) and `join` (273). The token and join code moved unchanged.
- **Check:** the 21 invite-link tests pass, and so does the gate.
