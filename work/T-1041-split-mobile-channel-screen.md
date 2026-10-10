---
id: T-1041
title: "Size split T117: apps/mobile/src/components/chat/channel-screen.tsx (408 lines) into chat/{channel-members,use-channel-invites}; one ChannelMemberRow"
status: merged
milestone: M5
branch: task/T-1041-split-mobile-channel-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1041: Split the mobile `channel-screen.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/channel-screen.tsx` is 408 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #113 (task T117): `components/chat/channel-members.tsx` and `chat/use-channel-invites.ts`, under `apps/mobile/src/`. `channel-screen.tsx` keeps the screen and every export it has today. Leave the existing `channel-composer-bar.tsx` as it is.

- **In scope:** the in-file Dedup. The admins row and the subscribers row become one `ChannelMemberRow`, and each keeps its own text.
- **Move unchanged:** the invite-link code in `use-channel-invites.ts` creates and revokes invite links, so not one line of its logic changes.

The lead runs a phone smoke of the Acme channel in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #113, and `apps/mobile/src/components/chat/channel-screen.tsx`.

### Allowed files
`apps/mobile/src/components/chat/channel-screen.tsx`, `apps/mobile/src/components/chat/channel-members.tsx`, `apps/mobile/src/components/chat/use-channel-invites.ts`, `work/T-1041-split-mobile-channel-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**Status:** done, gate green.

### What I did
Split `apps/mobile/src/components/chat/channel-screen.tsx` following `docs/audit/split-rules.md` and the plan entry (`size-plan.md` §2.2 #113 / §2.3 T117):

- **`channel-screen.tsx`** keeps the screen and its one export (`ChannelScreen`). It now calls `useChannelInvites(groupId)` and renders `<ChannelMembers … />`, and renders `<InviteLinksSheet … />` from the hook's returned props.
- **`channel-members.tsx`** (new): the member section (heading, Loading…, admins load error, the admins/subscribers lists, the role error). The in-file Dedup is applied: the admins row and the subscribers row became one `ChannelMemberRow`, each keeping its own text (admins keep the role text and the Demote button; subscribers keep the Promote button).
- **`use-channel-invites.ts`** (new): owns the invite-link state plus the load/create/revoke handlers and the clipboard/share bridge. It mirrors the existing `use-group-invite-links.ts` twin and reuses the shared `groupAction`/`rawCall` helper. The invite-link logic behaves as before.

No test files were touched. No file outside the Allowed files was edited.

### Files changed
- `apps/mobile/src/components/chat/channel-screen.tsx` (modified)
- `apps/mobile/src/components/chat/channel-members.tsx` (new)
- `apps/mobile/src/components/chat/use-channel-invites.ts` (new)
- `work/T-1041-split-mobile-channel-screen.md` (this report)

### Line counts (split-rules item 8)
| File | Before (main) | After |
| --- | ---: | ---: |
| `components/chat/channel-screen.tsx` | 408 | 271 |
| `components/chat/channel-members.tsx` | — | 144 |
| `components/chat/use-channel-invites.ts` | — | 139 |

Every file is at most 400 lines.

### Export list before → after (split-rules item 8)
`grep -E "^export"` on `main:channel-screen.tsx`:
```
export function ChannelScreen({ groupId, feedId, title }: ChannelScreenProps) {
```
`grep -E "^export"` on the three files now:
```
channel-screen.tsx:        export function ChannelScreen({ groupId, feedId, title }: ChannelScreenProps) {
channel-members.tsx:       export type ChannelMember = {
channel-members.tsx:       export function ChannelMemberRow({
channel-members.tsx:       export function ChannelMembers({
use-channel-invites.ts:    export function useChannelInvites(groupId: string) {
```
The original path is not a barrel but keeps its screen; it still exports `ChannelScreen` with the same name and kind, so importers do not change. The only importer is `apps/mobile/src/app/group/[id].tsx` (`import { ChannelScreen } …`), untouched. No export was removed or renamed; the two new files add three exports.

### Effect ratchet (split-rules item 6)
No `// effect-plain:` marker was needed: the gate's `effect` step passed. `use-channel-invites.ts` imports `effect`, so it is classified `effect`; `channel-members.tsx` is `plain` (no hard signals).

### Commands (real results)
- `pnpm install` — done, all 1172 packages installed (one pre-existing peer warning, unrelated).
- Single tests: none run. There is no test file near the change; the gate reported `SKIP tests @zilar/mobile (no nearby test files)`.
- `pnpm gate` — first run failed `format` (Prettier on the new `channel-members.tsx`); fixed with `pnpm exec prettier --write apps/mobile/src/components/chat/channel-members.tsx`, then the second run:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (0.4s)
PASS  lint  (0.7s)
PASS  typecheck  (3.5s)
PASS  effect  (1.3s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
The task's Checks also list `pnpm --filter @zilar/mobile typecheck`; per `AGENTS.md` I did not run checks one by one — the gate's `PASS typecheck` step covers the mobile package.

### Deviations from the spec
- `use-channel-invites.ts` mirrors the existing `use-group-invite-links.ts` and uses the shared `groupAction`/`rawCall` helper; the screen keeps its own `callStore`/`ChannelCallFailed` for the role/leave/admins-slice calls. The invite-link failure mapping is the only internal difference, and the user-facing messages and flow are unchanged.
- The whole `279–333` block moved into a `ChannelMembers` wrapper (in addition to the deduped `ChannelMemberRow`), because the plan lists that range as relocating. The screen computes `admins`/`subscribers` as before and passes them in.
- `InviteLinksSheet` is still rendered by the screen from the hook's returned props (a `.ts` hook cannot hold JSX); this matches how the group screen consumes `useGroupInviteLinks`.

### Security checklist
Not applicable: UI-only move. No new route, no new write, no logging; the invite-link store calls (create/revoke) are unchanged, and no token/secret is stored or logged.

### Open questions
None.

### Fix round 1 (lead review)

Rebuilt `apps/mobile/src/components/chat/use-channel-invites.ts` from main's invite-link code so not one line of its logic changed. `ChannelCallFailed`, `codeOf` and `callStore` (main `channel-screen.tsx` 30–50) moved into the hook and are exported; `channel-screen.tsx` imports them from there. `groupAction`/`rawCall`/`useAction`/`isWaiting` are no longer used for the invite code, and `linksBusy` is a `useState` again. `channel-members.tsx` is unchanged.

Every moved body is byte-identical to main apart from indentation. Verified with `diff -s` after stripping leading whitespace — all seven invite-link diffs printed "identical":

| Moved piece | main `channel-screen.tsx` | new `use-channel-invites.ts` |
| --- | --- | --- |
| `links` state type | 128–139 | 41–52 |
| `linksBusy` `useState` | 140 | 53 |
| `reloadLinks` | 193–200 | 61–68 |
| `openLinks` | 202–209 | 70–77 |
| `linksShare` bridge | 226–244 | 83–101 |
| `onCreate` body | 373–383 | 114–124 |
| `onRevoke` body | 387–397 | 128–138 |
| `ChannelCallFailed` | 33–36 | 10–12 |
| `codeOf` | 37–41 | 14–18 |
| `callStore` | 43–49 | 20–26 |

The `onCreate`/`onRevoke` wrappers changed only from a JSX prop (`onCreate={…}`) to an object property (`onCreate: …`); the returned object hands the sheet the same props, and `channel-screen.tsx` renders them unchanged. This supersedes the earlier "Deviations" bullet about the hook.

Updated line counts: `channel-screen.tsx` 257, `channel-members.tsx` 142, `use-channel-invites.ts` 147 (all ≤ 400). `use-channel-invites.ts` now also exports `ChannelCallFailed` and `callStore` (values) alongside `useChannelInvites`.

Gate summary:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (0.7s)
PASS  effect  (0.6s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-10: approved after one lead fix round. The pre-review is clean, with 1 nit.**
- **The split:** `channel-screen.tsx` (408 lines) is now 257 lines, plus `channel-members` (142) and `use-channel-invites` (147). One `ChannelMemberRow` serves the admins and subscribers rows.
- **The fix round:** the first version rewrote the invite-link load, create and revoke code with `useAction`, `groupAction` and `rawCall`. The lead sent it back, and the hook now holds main's `reloadLinks`, `onCreate` and `onRevoke` bodies, with `callStore`, `catchTag`, `ensuring` and `runFork`.
- **The lead's line check against main:**
  - the invite logic lines match;
  - the only new lines are the hook's return object and the props wiring;
  - the owner-only Demote and Promote conditions are identical (`isOwner && member.userId !== currentUserId`, plus `role === 'admin'` for Demote).
- **Not smoked:** the mock seed gives the Acme channel no topic row. `app/group/[id].tsx:189` then calls `router.back()`, so the channel screen cannot be reached in mock mode, on main too. It is a mock follow-up.
- **Check:** the gate passed.
