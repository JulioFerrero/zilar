---
id: T-1041
title: "Size split T117: apps/mobile/src/components/chat/channel-screen.tsx (408 lines) into chat/{channel-members,use-channel-invites}; one ChannelMemberRow"
status: todo
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

## Review (written by Claude)
