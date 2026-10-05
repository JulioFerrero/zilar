---
id: T-0218
title: "Mobile: tapping a tool on the AI screen opens its detail sheet (source, versions, recent runs; read only)"
status: merged
milestone: M5
branch: task/T-0218-mobile-tool-detail-read
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0217]
estimate: 0.5 day
---

# T-0218: Tool detail sheet (read only)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Web opens a detail panel for each tool (`ToolDetailPanel`); on the phone the tool rows on the AI screen are not tappable. This is the read half of `docs/audit/mobile-parity-gaps.md` 7.1 "T-0189b" (lines 1024-1041). The writes (Run now, Revert, Delete) come in the next task; do not build them here.

### What the person sees
Tapping a tool row in the Tools section of the AI edit screen opens a full-height sheet (React Native `Modal`, `animationType="slide"`, `presentationStyle="pageSheet"`, `onRequestClose` closes it) with a `ScrollView`:
- Header row: tool name (16 px, semibold, one line) and `v<currentVersion>` (mono, muted) on the right, then a close icon button (`X` from `lucide-react-native`, accessibility label `Close tool`).
- Under it (13 px, muted): the description; `Contacts: <hosts>` plus ` · Approved: <approvedHosts>` when there are hosts (`no sites` when empty, use `hostsLine` from `apps/mobile/src/lib/routines-format.ts`); `Waiting for approval: <hosts>. Ask the AI to approve these hosts.` when some host is not approved; `Last run: ok` / `Last run: error` when `lastRunStatus` is set.
- `Source (v<N>, read-only)` heading, then the source in a monospace block with line numbers on the left (muted), inside a horizontal `ScrollView` so long lines scroll instead of wrapping. When an older version is shown, under it: `Showing v<N> (<hosts>); revert to make it current.`
- `Version history` heading, one row per version (newest first, as the API gives them): `v<N> · <message>` (14 px) and `<hosts> · by <createdBy> · <date>` (12 px, muted). Tapping a row shows that version's source (accessibility label `Show source of v<N>`). `No versions yet.` when empty.
- `Recent runs` heading, one row per run: `ok · v3 · manual · 120 ms · <date>` or `error (<errorKind or failed>) · ...` (same text as web `runStatusText`); an error run adds `Failed: <errorKind or failed>`; an ok run with `outputText` shows its first 2000 characters (`truncateOutput` from `routines-format.ts`) with `Show all` / `Show less` when cut. `No runs yet.` when empty.
- Loading: `Loading…`. Load failed: `Could not load the tool.` (danger) with `Retry` and `Back`. A version that fails to load: `Could not load that version.` above the source. Never show server text.
- Dates: `new Date(x).toLocaleString()` like web.

### Verified facts (do not re-derive)
- Web: `apps/web/src/components/tools/ToolDetailPanel.tsx` (481 lines): helpers `hostsLine`, `runStatusText` (lines 25-33); load of detail + versions + runs with `Promise.all` (lines 80-109); `showVersion` (lines 111-126); header and hosts (lines 218-242); source (244-260); history (262-302); recent runs (337-363). Ignore Run now, Revert and Delete (next task).
- Web client: `apps/web/src/lib/tools.ts`: `toolDetailSchema` (lines 32-34, list item + `source`), `toolVersionSchema` (38-47), `toolVersionDetailSchema` (51-53, + `source`), `toolRunSchema` (57-68: `id, toolId, version, trigger ('manual'|'routine'|'ai'), status ('ok'|'error'), errorKind (string|null), durationMs, fetchCount, outputText (string|null), createdAt`); `getToolDetail` `GET /tools/:id`, `listToolVersions` `GET /tools/:id/versions`, `getToolVersion` `GET /tools/:id/versions/:n`, `listToolRuns` `GET /tools/:id/runs` (lines 157-178).
- Server: the four GET routes in `apps/server/src/tools/routes.ts` lines 156-178.
- Mobile client: `apps/mobile/src/lib/tools-api.ts`: type guards and `parseToolListItem` (lines 85-145), `request` (212-243), `createToolsApi` with `parseList` and `withToken` (246-276), `ToolsApi` (55-58), `RoutineActionsApi` (64-68), `AiToolsApi = ToolsApi & RoutineActionsApi` (71). All mobile paths start with `/api`.
- Mock: `apps/mobile/src/mock/tools.ts`: `TOOLS` (`tool-1` "Morning briefing" v3 with hosts, `tool-2` "Draft helper" v1 no hosts), `createMockToolsApi(): AiToolsApi` (line 105).
- Section: `apps/mobile/src/components/ais/tools-section.tsx`: `ToolRow` (lines 39-58, a plain `View`), `ToolsSectionContent` (64-96), `ToolsSection({ api: ToolsApi, aiId })` (103-134). Mounted in `apps/mobile/src/app/ais/[id].tsx` line 332 with the `AiToolsApi` from `useToolsApi()`.
- `apps/mobile/src/lib/routines-format.ts` has `hostsLine`, `truncateOutput` (line 131), `MAX_OUTPUT_PREVIEW_CHARS = 2000`.
- Sheet style reference: `apps/mobile/src/components/ais/ai-actions-sheet.tsx` (`Modal`, `useSafeAreaInsets`, `bg-background`, `border-divider`).

### What to build
1. `tools-api.ts`: types `ToolDetail` (list item + `source`), `ToolVersion`, `ToolVersionDetail` (+ `source`), `ToolRun`, with guards like the existing ones (a bad item makes the whole answer `invalid_response`). A new interface `ToolDetailsApi { getTool(id); listToolVersions(id); getToolVersion(id, version); listToolRuns(id) }`; `AiToolsApi` becomes `ToolsApi & RoutineActionsApi & ToolDetailsApi`; implement the four in `createToolsApi` (paths `/api/tools/<id>`, `/versions`, `/versions/<n>`, `/runs`, ids with `encodeURIComponent`).
2. `mock/tools.ts`: detail data for both tools: a short multi-line `source` per version, `tool-1` with 3 versions (v3 current, v2, v1 with different hosts) and 3 runs (2 ok with output, one longer than 2000 characters, 1 error `timeout`), `tool-2` with 1 version and no runs. Unknown id: `ToolsApiError(404, 'not_found', ...)`.
3. New `apps/mobile/src/components/ais/tool-detail-format.ts`: `runStatusText(run)` (as web), `waitingHosts(tool)` (hosts not in `approvedHosts ?? []`), `numberedLines(source)` (`{ n, text }[]`).
4. New `apps/mobile/src/components/ais/tool-detail-sheet.tsx`: `ToolDetailSheet({ api, toolId, onClose })` (`toolId: string | null`, visible when not null) and a hook-free `ToolDetailBody` for the states (loading, error, ready with a given detail/versions/runs/shown version) for tests. Load with `Promise.all` like web; ignore results after close or unmount.
5. `tools-section.tsx`: prop `api: AiToolsApi`; each `ToolRow` becomes a `Pressable` (`accessibilityRole="button"`, label `Open <name>`, `active:bg-list-hover`) that sets the open tool id; render `<ToolDetailSheet api={api} toolId={openId} onClose={...} />`. Keep `loadAiTools(api: ToolsApi, ...)` as is.
6. Tests (Vitest):
   - `apps/mobile/src/lib/tools-api.test.ts`: the four paths with bearer, parsing, a bad version or run item gives `invalid_response`, a 404 keeps its status.
   - New `apps/mobile/src/components/ais/tool-detail-format.test.ts`: `runStatusText` ok and error (with and without `errorKind`), `waitingHosts` (none, some, `approvedHosts` missing), `numberedLines` (empty string, trailing newline).
   - New `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (same pattern as `routines-section.test.tsx`: static markup of the body): loading, error with Retry and Back, ready shows name, `v3`, contacts, waiting line, source lines with numbers, history rows, runs (ok, error with `Failed: timeout`, the truncated one shows `Show all`), empty history and runs lines, older version note.
   - `apps/mobile/src/components/ais/tools-section.test.tsx`: rows have the `Open <name>` label.

### Read first
`AGENTS.md`, `apps/web/src/components/tools/ToolDetailPanel.tsx` (lines 1-130 and 187-363), `apps/web/src/lib/tools.ts` (lines 1-180), `apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/ai-actions-sheet.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx` (test pattern).

### Allowed files
`apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/lib/tools-api.test.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/tool-detail-format.ts` (new), `apps/mobile/src/components/ais/tool-detail-format.test.ts` (new), `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (new), `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (new), `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx`, `work/T-0218-mobile-tool-detail-read.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api tool-detail-format tool-detail-sheet tools-section
pnpm gate
```

### Acceptance
- Tapping a tool opens the sheet with header, hosts, numbered source, version history (tap shows that version), recent runs, and the fixed sentences; the close button and the Android back button close it.
- With `?mock=1` the sheet shows the mock data for both tools.
- No Run now, Revert or Delete; no server, web or package change; no new dependency; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Run now, Revert, Delete (next task), syntax highlighting, group and topic tools.

---

## Report (written by the worker when done)

Done. Tapping a tool row in the AI edit screen's Tools section now opens a
full-height read-only detail sheet (slide `Modal`, `pageSheet`,
`onRequestClose` closes it) with header, hosts, numbered source, version
history (tap shows that version's source) and recent runs.

What I changed:
- `apps/mobile/src/lib/tools-api.ts`: new types `ToolDetail`,
  `ToolVersion`, `ToolVersionDetail`, `ToolRun` (+ trigger/status unions)
  with guards matching the existing style (one bad item gives
  `invalid_response`); new `ToolDetailsApi` (`getTool`, `listToolVersions`,
  `getToolVersion`, `listToolRuns` on `/api/tools/<id>[/versions[/<n>]]`,
  `[/runs]`, ids `encodeURIComponent`-ed); `AiToolsApi` is now
  `ToolsApi & RoutineActionsApi & ToolDetailsApi`. All existing methods kept
  (one edit accidentally dropped `pauseRoutine`/`resumeRoutine`; restored and
  verified by the passing pause/resume tests).
- `apps/mobile/src/mock/tools.ts`: per-version multi-line sources; `tool-1`
  has 3 versions (v3 current, v2, v1 with no hosts) and 3 runs (ok with short
  output, error `timeout`, ok with 2644-char output > 2000 preview cap);
  `tool-2` has 1 version and no runs; unknown ids throw 404 `not_found`.
- `apps/mobile/src/components/ais/tool-detail-format.ts` (new):
  `runStatusText` (as web), `waitingHosts` (missing `approvedHosts` = none
  approved), `numberedLines` (empty = no lines, trailing newline adds none).
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (new):
  `ToolDetailSheet({ api, toolId, onClose })` (pageSheet slide Modal, `X`
  close icon with `Close tool` label, loader keyed by `toolId` so switching
  tools remounts fresh, `Promise.all` load with ignore-after-unmount) and
  hook-free `ToolDetailBody` for tests. Fixed sentences only
  (`Could not load the tool.`, `Could not load that version.`), never server
  text. Dates via `toLocaleString()`. Output uses `truncateOutput` with
  `Show all`/`Show less`. No Run now/Revert/Delete.
- `apps/mobile/src/components/ais/tools-section.tsx`: prop is now
  `api: AiToolsApi`; `ToolRow` is a `Pressable` (`button` role,
  `Open <name>` label, `active:bg-list-hover`) opening the sheet;
  `loadAiTools(api: ToolsApi, ...)` unchanged.
- Tests: extended `tools-api.test.ts` (4 detail paths + bearer, bad
  version/run item = `invalid_response`, 404 keeps status) and
  `tools-section.test.tsx` (`Open <name>` labels, sheet import mocked);
  new `tool-detail-format.test.ts` and `tool-detail-sheet.test.tsx`
  (static-markup body tests: loading, error with Retry+Back, full ready
  state, waiting line, older-version note, version error, empty
  history/runs, output expand, Retry/Back/history-row wiring).

Commands (real results):
- `pnpm install`: done (11.8s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/tools-api.test.ts`: 16 passed.
- `... tool-detail-format.test.ts`: 9 passed.
- `... tool-detail-sheet.test.tsx src/components/ais/tools-section.test.tsx`:
  23 passed (11 + 12).
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json`: clean.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS tests @zilar/mobile`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`
  (10 changed files, all within scope).

Problems: initial sheet effect reset state synchronously inside the effect
(lint `set-state-in-effect`); fixed by splitting into `ToolDetailSheet`
(Modal) + keyed `ToolDetailLoader`, which also removes stale state when
switching tools. The `nativewind` `useColorScheme` import needed a test
mock (`light`).

Deviations: none. Security checklist: no secrets/tokens in logs or UI
fixed sentences carry no server text; no deletes/updates added; no new
routes; mock data only.

Open questions: none.

status: review

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (paid Muse). Four read routes with bearer and `encodeURIComponent`, guards that make a bad version or run item `invalid_response`, mock detail data for both tools, the format helpers, `ToolDetailSheet` (page sheet, numbered source, version history, recent runs, fixed sentences only), and tappable tool rows labelled `Open <name>`. Emulator smoke PASS on home. Not seen on a device: the test account has no AI, and `?mock=1` through a deep link still loads the real AIs API in the smoke build ("That AI no longer exists."), like T-0189 and T-0213. Accepted nits: Retry keeps the error panel up while it reloads; the 404 test covers two of the four reads.
