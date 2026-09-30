---
id: T-0141
title: Web and server: deferred review follow-ups (stickers, revoke, approvals)
status: todo
milestone: M5
branch: task/T-0141-web-server-followups
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0120, T-0133, T-0116]
estimate: 1 day
---

# T-0141: Web and server: deferred review follow-ups

## Spec (written by Claude, do not edit)

### Why
Merged tasks left small deferred review items (see the Review sections of T-0120, T-0133, T-0116). No schema change, no migration. Read `AGENTS.md` first, including the security checklist.

### What to build
1. Stickers (T-0120): `resolveStorageDir` must not depend on the process cwd; resolve a relative `STICKER_STORAGE_DIR` against a stable base (the server package root or the config file's directory, pick one, document it in `docs/SERVER_CONFIG.md`) and keep absolute paths as they are; test it from two different cwds. Mock/demo mode: panel stickers must be sendable (relative mock URLs that pass `StickerSchema`, not `data:` URLs); test that sending a demo sticker succeeds in mock mode. Remove the unused `panelRef` in `StickerPanel`.
2. Web invite links (T-0133): the revoke button must stay busy until the DELETE settles (`onRevoke` typed `void | Promise<void>` and awaited); a superseded remove-member recheck must not show "The chat list refresh was superseded." in the panel (retry once, or a generic message); remove the unreachable 404 branch in the panel `leave()`; clear `quietArchiveIds` when the user navigates away first; mock join cap respects `alreadyMember`. Tests for each behavioural change.
3. Approvals (T-0116/T-0134): web `ApprovalCard` must read the approver names from the list payload T-0134 added instead of one `getTopic` call per card (no N+1); test that N cards cause no per-card topic fetch.
4. Do not touch the schema, migrations, packages or dependencies.

### Read first
`AGENTS.md`, the Report and Review sections of `work/T-0120-stickers.md`, `work/T-0133-web-followups.md`, `work/T-0116-group-roles.md`, `work/T-0134-server-followups.md`.

### Allowed files
`apps/server/src/stickers/**`, `apps/server/src/config.ts` (only for the sticker dir), `docs/SERVER_CONFIG.md`, `apps/web/**`, `work/T-0141-web-server-followups.md`. Not allowed: schema, drizzle, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2 <touched sticker/config test files>
pnpm --filter @galena/web test --maxWorkers=2 <touched test files and their neighbours>
```

## Report (written by the worker)

## Review (written by Claude)
