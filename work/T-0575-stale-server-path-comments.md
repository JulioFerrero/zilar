---
id: T-0575
title: "Comments only: web and mobile API clients point at server routes.ts files the Effect HTTP moves deleted; repoint each to the file that now holds the contract (api.ts / service.ts); no code change"
status: todo
milestone: M5
branch: task/T-0575-stale-server-path-comments
model: auto
effort: low
depends_on: [T-0560]
estimate: 0.25 day
---

# T-0575: fix comments that name deleted server files

## Spec (written by Claude, do not edit)

### Why
The Effect HTTP moves (T-0514 onward) replaced many `apps/server/src/<module>/routes.ts` files with `api.ts`. Comments in the web and mobile clients still say "the wire contract lives in …/routes.ts", so a reader following them finds nothing. **This task changes comments only.**

### Verified facts (the lead ran the scan below on main at 07:58 on 2026-10-08)
The scan prints each comment path under `apps/server/src/` that names a file which no longer exists:
```bash
grep -rnoE "apps/server/src/[a-z0-9/-]+\.ts" apps packages docs --include='*.ts' --include='*.tsx' | grep -v node_modules | while IFS=: read f l p; do [ -f "$p" ] || echo "$f:$l $p"; done
```
Its hits:
- **web:** `apps/web/src/lib/api.ts` lines 851 (chat-prefs), 937 (chat-folders), 1063 (agents/memory), 1116 (media, deleted by T-0560) and 1173 (ais);
- **mobile:**
  - `apps/mobile/src/lib/directory-api.ts:12`;
  - `apps/mobile/src/lib/ai-memory-api.ts:11`;
  - `apps/mobile/src/lib/chat-folders-api.ts:16`;
  - `apps/mobile/src/lib/groups-api.ts:12`;
  - `apps/mobile/src/lib/profile-api.ts:11`;
  - `apps/mobile/src/lib/chat-prefs-api.ts:10`;
  - `apps/mobile/src/lib/ais-api.ts:10`;
  - `apps/mobile/src/lib/contacts-api.ts:10`.
- **Not a comment, leave it:** `packages/devtools/src/lead/spec-check.test.ts:16,28` uses `contacts/routes.ts` as a test fixture string.

### What to build
1. **Run the scan again** (T-0560 merged after the lead's run, and later merges may add hits).
2. **For each hit in a web or mobile comment,** replace the dead path with the file that now holds that contract:
   - usually `apps/server/src/<module>/api.ts`, keeping any `service.ts` mention;
   - for `agents/memory`, check where the memory routes now live (grep for `HttpApiGroup` with memory);
   - for `handles`, check `apps/server/src/handles/api.ts`.
   
   Change only the path text. List every change in the Report.
3. **The scan must print only the devtools fixture lines at the end.** Paste its output into the Report.

### Read first
`AGENTS.md` and each hit line with 3 lines around it.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/mobile/src/lib/directory-api.ts`, `apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/chat-folders-api.ts`, `apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/profile-api.ts`, `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/lib/contacts-api.ts`, `work/T-0575-stale-server-path-comments.md`.

If the scan finds a hit in a file not listed here, report it in the Report; do not edit it.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every web and mobile comment that named a deleted server file now names the live one.
- There are no code changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
