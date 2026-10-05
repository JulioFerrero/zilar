---
id: T-0189
title: Mobile: the AI edit screen lists the AI's tools and routines (read only)
status: planned
milestone: M5
branch: task/T-0189-mobile-ai-tools-routines-read
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 1 day
---

# T-0189: Tools and Routines on the phone's AI screen (read only)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". The web AI panel shows the AI's Tools and Routines; the phone shows neither. This is part 1 of the split in `docs/audit/mobile-parity-gaps.md` section 7.1 (T-0189a): read only. Writes (run, revert, delete, pause, resume) come in later tasks.

### What the person sees
On the AI edit screen (`/ais/<id>`), under the Home machine block and above the error line, two sections:

- **Tools**: heading `Tools` (13 px, semibold, muted). One row per tool: the name (14 px, medium) and `v<currentVersion>` (12 px, monospace, muted) on one line; the description (12 px, muted, one line); then `<hosts> · <last run>` (12 px, muted, one line), where hosts is `no sites` when the list is empty, else the hosts joined by `, `, followed by ` · approved: <approved hosts>` when `approvedHosts` is present and hosts is not empty; last run is `never run` or `last run ok` / `last run error`, then ` · ` and the `updatedAt` date (`toLocaleDateString()`). Rows are not tappable yet.
- **Routines**: heading `Routines`. One row per routine: the title (14 px, medium); `<schedule in plain words> · runs <toolName> · <status>` where status is `needs approval`, `paused` or `active`; `next <nextRunAt toLocaleString()> · <last>` where last is `never run` or `last <lastStatus>` plus ` · <lastRunAt toLocaleString()>` when known; and the paused explanation line from `pausedReasonText` when it is not null.
- States for each section: `Loading…`; empty: Tools `No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat.`, Routines `No routines here yet. Ask the AI in the chat to schedule one.`; error: the error sentence in the danger colour plus a `Retry` button (outline) that reloads only that section. A 404 or an unparseable response counts as an empty list, not an error (web does the same).

All copy above is copied from web; do not change it.

### Verified facts (do not re-derive)
- Web client: `apps/web/src/lib/tools.ts`. `toolListItemSchema` lines 13-28 (fields `id, aiId, groupId, topicId, name, description, currentVersion, hosts, approvedHosts?, lastRunStatus ('ok'|'error'|null), updatedAt, scope?`); `listAiToolDetails` lines 152-154 calls `GET /ais/:id/tools`; `routineSchema` lines 207-223 (`id, aiId?, groupId?, topicId?, toolId?, title, toolName, schedule (unknown), status ('active'|'paused'|'needs_approval'), pausedReason ('user'|'failures'|'hosts_changed'|null), nextRunAt, lastRunAt (nullable), lastStatus ('ok'|'error'|'skipped'|null), approvedHosts, scope?`); `listAiRoutines` lines 228-230 calls `GET /ais/:id/routines`.
- Server routes: `apps/server/src/tools/routes.ts` line 89 (`GET /ais/:id/tools`) and `apps/server/src/routines/routes.ts` line 53 (`GET /ais/:id/routines`), both for the AI owner.
- Web plain-words helpers: `apps/web/src/lib/routines.ts` (135 lines, no imports, pure): `describeRoutineSchedule` (line 25), `pausedReasonText` (line 108), `MAX_OUTPUT_PREVIEW_CHARS` and `truncateOutput` (lines 128-130), tested in `apps/web/src/lib/routines.test.ts`. Copy the file as it is.
- Web row text: `apps/web/src/components/tools/ToolsSection.tsx` lines 14-22 (`hostsLine`, `lastRunText`), 116-170 (render); `apps/web/src/components/tools/RoutinesSection.tsx` lines 16-35 (`statusText`, `nextRunText`, `lastStatusText`), 168-215 (render).
- Mobile pattern to copy: `apps/mobile/src/lib/approvals-api.ts` (types, `ApprovalsApiError` with `status` and `code`, defensive parsers, `createApprovalsApi(getToken, fetchImpl, apiUrl)` line 235), its mock `apps/mobile/src/mock/approvals.ts` (`createMockApprovalsApi` line 86) and its hook `apps/mobile/src/components/chat/use-approvals-api.ts`. The request helper with bearer auth and error parsing is `request` in `apps/mobile/src/lib/ais-api.ts` lines 181-211.
- The AI edit screen is `apps/mobile/src/app/ais/[id].tsx` (335 lines). It is only reachable for the person's own AIs. The Home machine block ends at line 323 (`</View>`); the error line follows at 325. The screen gets the AI id from the route and uses `useAisApi()` (line 38) and `useMachinesApi()` (line 40).

### What to build
1. New `apps/mobile/src/lib/tools-api.ts`: types `ToolListItem` and `Routine` as above, `ToolsApiError` (status, code), `ToolsApi { listAiTools(aiId): Promise<ToolListItem[]>; listAiRoutines(aiId): Promise<Routine[]> }`, defensive parsers (skip nothing silently: an item that does not parse makes the whole response `invalid_response`), `createToolsApi(getToken, fetchImpl = fetch, apiUrl = API_URL)`.
2. New `apps/mobile/src/mock/tools.ts`: `createMockToolsApi()` with two tools (one with hosts and approved hosts, one with no hosts and never run) and two routines (one active, one paused with reason `failures`).
3. New `apps/mobile/src/components/ais/use-tools-api.ts`: picks the real or mock API exactly like `use-approvals-api.ts`.
4. New `apps/mobile/src/lib/routines-format.ts`: a copy of `apps/web/src/lib/routines.ts`, plus the row-text helpers from web (`hostsLine`, `toolLastRunText`, `routineStatusText`, `nextRunText`, `routineLastText`) as pure exported functions.
5. New `apps/mobile/src/components/ais/tools-section.tsx` and `apps/mobile/src/components/ais/routines-section.tsx`: each takes `{ api: ToolsApi; aiId: string }`, loads on mount, shows the states above. Use the existing `Text` and `Button` components and the classes already used on the AI screen (`text-muted-foreground`, `text-danger`, `text-foreground`); no literal hex, icons only from `lucide-react-native` if any, no emoji.
6. `apps/mobile/src/app/ais/[id].tsx`: mount both sections under the Home machine block, only when the screen has loaded (status ready), passing `aiId`. Nothing else on the screen changes.
7. Tests (Vitest): `apps/mobile/src/lib/tools-api.test.ts` (paths, bearer header, parsing of both lists, a bad item gives `invalid_response`, a 404 is a `ToolsApiError` with status 404); `apps/mobile/src/lib/routines-format.test.ts` (the cases of `apps/web/src/lib/routines.test.ts` plus each row-text helper); `apps/mobile/src/components/ais/tools-section.test.tsx` (rows from the mock, the empty sentences, error with Retry reloading, 404 shown as empty) and the same for routines in `apps/mobile/src/components/ais/routines-section.test.tsx`.

### Read first
`AGENTS.md` (mobile pitfalls), `apps/web/src/lib/tools.ts` (lines 1-160 and 205-236), `apps/web/src/lib/routines.ts`, `apps/web/src/components/tools/ToolsSection.tsx`, `apps/web/src/components/tools/RoutinesSection.tsx` (lines 1-40 and 160-215), `apps/mobile/src/lib/approvals-api.ts`, `apps/mobile/src/mock/approvals.ts`, `apps/mobile/src/components/chat/use-approvals-api.ts`, `apps/mobile/src/app/ais/[id].tsx`.

### Allowed files
`apps/mobile/src/lib/tools-api.ts` (new), `apps/mobile/src/lib/tools-api.test.ts` (new), `apps/mobile/src/mock/tools.ts` (new), `apps/mobile/src/components/ais/use-tools-api.ts` (new), `apps/mobile/src/lib/routines-format.ts` (new), `apps/mobile/src/lib/routines-format.test.ts` (new), `apps/mobile/src/components/ais/tools-section.tsx` (new), `apps/mobile/src/components/ais/tools-section.test.tsx` (new), `apps/mobile/src/components/ais/routines-section.tsx` (new), `apps/mobile/src/components/ais/routines-section.test.tsx` (new), `apps/mobile/src/app/ais/[id].tsx`, `work/T-0189-mobile-ai-tools-routines-read.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api routines-format tools-section routines-section
pnpm gate
```
The lead checks the AI screen on the Android emulator (`pnpm phone:smoke`) before merging.

### Acceptance
- The AI edit screen shows Tools and Routines with the web's copy and states; 404 reads as empty.
- No server, web or package change; no new dependency; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Tapping a tool, tool detail, run now, revert, delete, pause, resume, delete routine, the activity feed (later T-0189 parts).

---

## Report (written by the worker when done)

## Review (written by Claude)
