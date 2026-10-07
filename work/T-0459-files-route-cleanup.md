---
id: T-0459
title: "Cleanup (doctor nits): one shared isDmBlocked for media + files routes; strict RFC 5987 filename in /api/files"
status: merged
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

### What I did

1. **Shared `isDmBlocked`.** Moved the function with its comment into
   `apps/server/src/blocks/service.ts` as an export, same signature
   `(db: ServerDatabase, userId: string, peerJid: string)` and the same query.
   Deleted both copies and imported it in `media/routes.ts` (call at the DM
   check) and `files/routes.ts` (call at the DM check). Removed the imports
   that only the copies used: `media/routes.ts` dropped `or` and `sql` from
   `drizzle-orm` and `userBlocks`, `xmppAccounts` from `../db/schema`;
   `files/routes.ts` dropped `or` and `sql` and `userBlocks`, `xmppAccounts`.
   `blocks/service.ts` already imported everything the function needs.
2. **Strict RFC 5987 filename.** Added `encodeRfc5987(value)` to
   `files/routes.ts` (`encodeURIComponent` then `'`→`%27`, `(`→`%28`,
   `)`→`%29`, `*`→`%2A`) and used it for the `filename*` parameter.
3. **Test.** Added `encodes a tricky filename per RFC 5987` to
   `apps/server/src/files/routes.test.ts`: a `mediaItems` row named
   `it's (1)*.pdf` must answer
   `content-disposition: attachment; filename*=UTF-8''it%27s%20%281%29%2A.pdf`.
   The existing blocked-DM tests in `media/routes.test.ts` and
   `files/routes.test.ts` were not touched.

### Files changed

- `apps/server/src/blocks/service.ts`
- `apps/server/src/media/routes.ts`
- `apps/server/src/files/routes.ts`
- `apps/server/src/files/routes.test.ts`
- `work/T-0459-files-route-cleanup.md`

### Commands and real results

- `pnpm install` — done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files/routes media/routes blocks`
  — 3 test files passed, 38 tests passed, exit 0.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (13.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (7.2s)
  PASS  tests @zilar/server  (268.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Exit 0; no file outside the Allowed files.

### Problems / deviations / open questions

- None. No spec deviation. `git status --short` shows exactly the five allowed files.

## Review (written by Claude)

Approved (lead, 2026-10-07). isDmBlocked now lives once in blocks/service.ts and both the media and files routes import it. encodeRfc5987 tightens the filename (quote, parentheses, asterisk) and is tested. Pre-review clean.
