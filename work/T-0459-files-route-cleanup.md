---
id: T-0459
title: "Cleanup (doctor nits): one shared isDmBlocked for media + files routes; strict RFC 5987 filename in /api/files"
status: todo
milestone: M5
branch: task/T-0459-files-route-cleanup
model: auto
effort: low
depends_on: [T-0453]
estimate: 0.15 day
---

# T-0459: files route cleanup

## Spec (written by Claude, do not edit)

### Why
The doctor audit of `f703edb` found two nits in the T-0453 file route:
- **The block check is copied.** If someone later fixes it in one copy only, a blocked DM could be hidden in the gallery but still downloadable, or the other way round.
- **The download filename is not strict RFC 5987:** `'`, `(`, `)` and `*` are left raw.

### Verified facts (do not re-derive)
- **`isDmBlocked`:**
  - `apps/server/src/media/routes.ts:108-131` has the comment and `async function isDmBlocked(db, userId, peerJid)`, using `xmppAccounts` with a lowercased jid, then `userBlocks` in either direction. It is called at line 187.
  - `apps/server/src/files/routes.ts:48-72` has the identical copy, called at line 159.
- **`apps/server/src/blocks/service.ts`** exports block helpers (`blockUser` at line 55, `unblockUser` at 116, `listBlockedUsers` at 135). This is the place for the shared one.
- **The filename:** `apps/server/src/files/routes.ts:119-122` sets `` `attachment; filename*=UTF-8''${encodeURIComponent(name)}` ``.

### What to build
1. **Move `isDmBlocked`** with its comment into `apps/server/src/blocks/service.ts` as an export, keeping the same signature and query. Delete both copies and import it in `media/routes.ts` and `files/routes.ts`. Remove imports that become unused.
2. **In `files/routes.ts`,** add a small `encodeRfc5987(value)`: `encodeURIComponent(value)` plus replacing `'`, `(`, `)` and `*` with `%27`, `%28`, `%29` and `%2A`. Use it for `filename*`.
3. **Tests:**
   - in `apps/server/src/files/routes.test.ts`, a file named `it's (1)*.pdf` gets `content-disposition: attachment; filename*=UTF-8''it%27s%20%281%29%2A.pdf`;
   - the existing blocked-DM tests in `media/routes.test.ts` and `files/routes.test.ts` still pass unchanged.

### Read first
`AGENTS.md`, `apps/server/src/media/routes.ts:1-30` and `:100-135`, `apps/server/src/files/routes.ts`, `apps/server/src/blocks/service.ts`.

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/media/routes.ts`, `apps/server/src/files/routes.ts`, `apps/server/src/files/routes.test.ts`, `work/T-0459-files-route-cleanup.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files/routes media/routes blocks
pnpm gate
```

### Acceptance
- There is one `isDmBlocked`, exported from `blocks/service.ts` and used by both routes.
- The `filename*` value is strict RFC 5987 and tested.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
