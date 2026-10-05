---
id: T-0189
title: Mobile: the AI edit screen lists the AI's tools and routines (read only)
status: merged
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

Done. The AI edit screen (`/ais/<id>`) now shows Tools and Routines sections
(read only) under the Home machine block, with web's copy and states.

What I built (all inside Allowed files, 12 changed files):
- `apps/mobile/src/lib/tools-api.ts` (new): `ToolListItem` / `Routine` types,
  `ToolsApiError` (status, code), `ToolsApi { listAiTools, listAiRoutines }`,
  defensive type-guard parsers (one bad item fails the whole list as
  `invalid_response`), `createToolsApi(getToken, fetchImpl, apiUrl)` with
  bearer auth, paths `/api/ais/:id/tools` and `/api/ais/:id/routines`.
- `apps/mobile/src/lib/routines-format.ts` (new): copy of web
  `routines.ts` plus pure row-text helpers `hostsLine`, `toolLastRunText`,
  `routineStatusText`, `nextRunText`, `routineLastText`.
- `apps/mobile/src/mock/tools.ts` (new): `createMockToolsApi()` with two
  tools (hosts+approved / no hosts+never run) and two routines (active /
  paused with `failures`).
- `apps/mobile/src/components/ais/use-tools-api.ts` (new): real-or-mock
  picker mirroring `use-approvals-api.ts`.
- `apps/mobile/src/components/ais/tools-section.tsx` +
  `routines-section.tsx` (new): `{ api, aiId }`, load on mount, states
  `Loading…` / exact web empty sentences / fixed error sentence
  (`Could not load the tools/routines. Try again.`) in danger colour with an
  outline `Retry` that reloads only that section. `loadAiTools` /
  `loadAiRoutines` map 404 and `invalid_response` to `[]`, like web. Rows
  are `View`s (not tappable). Only `Text`/`Button` and existing screen
  classes; no hex, no emoji, no icons.
- `apps/mobile/src/app/ais/[id].tsx`: mounts both sections under the Home
  machine block (inside the ready branch, above the error line) via
  `useToolsApi()`. Nothing else changed.
- Tests: `tools-api.test.ts` (paths, bearer header, both lists, bad item
  gives `invalid_response`, 404 `ToolsApiError`), `routines-format.test.ts`
  (all web `routines.test.ts` cases plus each helper),
  `tools-section.test.tsx` / `routines-section.test.tsx` (mock rows, empty
  sentences, error with Retry wired to reload, 404/invalid_response read as
  empty via the exported loaders). Section bodies are exported pure
  components because the repo has no DOM/effects test setup
  (`renderToStaticMarkup` only); the mount effect itself is covered by the
  loading-state render plus the loader unit tests.

Commands and real results:
- `pnpm install`: pass (11.8s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api
  routines-format tools-section routines-section`: 4 files, 42 tests passed.
- `pnpm gate` (repo root): GATE PASS. Summary lines: `gate: 12 changed
  file(s) against main / PASS install (frozen) (0.9s) / PASS format (10.5s)
  / PASS lint (0.8s) / PASS typecheck (6.0s) / PASS tests @zilar/mobile
  (1.5s) / scope: every changed file is inside the Allowed files / GATE
  PASS`. First gate run failed on prettier formatting of 7 new files; fixed
  with `prettier --write` limited to my files, then re-ran tests + gate.

Deviations: none from the spec. Fixed error sentences instead of raw server
text per the mobile pitfalls (user-facing errors are fixed sentences).
No new dependency, no server/web change.

Open questions: none.

Security checklist: bearer token only in the `authorization` header, never
logged; no deletes/updates added (read-only GETs); no audit entries; no new
routes; fixed error sentences (no server internals leak to the UI).

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (free Muse). New `tools-api.ts` (tools and routines read, defensive parsing, `ToolsApiError`), its mock and hook, `routines-format.ts` (the web plain-words helpers plus the row-text helpers), and `ToolsSection` / `RoutinesSection` mounted under Home machine on the AI edit screen (7 added lines there). Emulator: `pnpm phone:smoke` PASS but it skips `/ais/[id]` (route parameter), and the test account has no AI (creating one needs a provider key), so the sections were NOT seen on a device; the component tests cover rows, the empty sentences, the error with Retry and 404 as empty. Julio should glance at an AI's screen on his phone after the next release.
