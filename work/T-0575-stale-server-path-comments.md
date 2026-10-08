---
id: T-0575
title: "Comments only: web and mobile API clients point at server routes.ts files the Effect HTTP moves deleted; repoint each to the file that now holds the contract (api.ts / service.ts); no code change"
status: merged
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

Repointed 13 stale `routes.ts` comment paths to the live `api.ts` contract files; comments only, no code changes.

Changes (old -> new):
- `apps/web/src/lib/api.ts`: `chat-prefs/routes.ts` -> `chat-prefs/api.ts` (kept `service.ts`); `chat-folders/routes.ts` -> `chat-folders/api.ts`; `agents/memory/routes.ts` -> `agents/memory/api.ts` (verified `HttpApiGroup` memory group lives in `apps/server/src/agents/memory/api.ts`); `media/routes.ts` -> `media/api.ts`; `ais/routes.ts` -> `ais/api.ts` (kept `service.ts`).
- `apps/mobile/src/lib/directory-api.ts:12`: `directory/routes.ts` -> `directory/api.ts`.
- `apps/mobile/src/lib/ai-memory-api.ts:11`: `agents/memory/routes.ts` -> `agents/memory/api.ts`.
- `apps/mobile/src/lib/chat-folders-api.ts:16`: `chat-folders/routes.ts` -> `chat-folders/api.ts`.
- `apps/mobile/src/lib/groups-api.ts:12`: `groups/routes.ts` -> `groups/api.ts`.
- `apps/mobile/src/lib/profile-api.ts:11`: `handles/routes.ts` -> `handles/api.ts` (verified `apps/server/src/handles/api.ts` exists).
- `apps/mobile/src/lib/chat-prefs-api.ts:10`: `chat-prefs/routes.ts` -> `chat-prefs/api.ts` (kept `service.ts`).
- `apps/mobile/src/lib/ais-api.ts:10`: `ais/routes.ts` -> `ais/api.ts` (path text only; existing `ais/service.ts` mention untouched).
- `apps/mobile/src/lib/contacts-api.ts:10`: `contact-requests/routes.ts` -> `contact-requests/api.ts` (kept `service.ts`).

Verified every replacement target exists on disk (`api.ts` in chat-prefs, chat-folders, agents/memory, media, ais, groups, handles, directory, contact-requests; plus `service.ts` where kept). Confirmed via `git diff` that all changed lines are comment lines plus the task status line.

Final scan output (only the expected devtools fixture lines remain):
```
packages/devtools/src/lead/spec-check.test.ts:16 apps/server/src/contacts/routes.ts
packages/devtools/src/lead/spec-check.test.ts:28 apps/server/src/contacts/routes.ts
```

Commands:
- `pnpm install`: exit 0 (12.7s).
- Per AGENTS.md I did not run individual test files one by one before the gate (comments-only change); `pnpm gate` ran the suites.
- `pnpm gate`: GATE PASS. Summary lines: `PASS install (frozen) (1.6s)`, `PASS format (21.0s)`, `PASS lint (1.4s)`, `PASS typecheck (10.5s)`, `PASS tests @zilar/mobile (13.2s)`, `PASS tests @zilar/web (44.4s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. 10 changed files, all inside Allowed files.

No deviations, no open questions.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (08:34) is newer than HEAD d5a4e5df.
- **Lead check:** the lead read the whole diff. It changes 13 comment paths and no code, and every new path exists on main (`ls` checked).
