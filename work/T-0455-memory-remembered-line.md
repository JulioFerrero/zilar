---
id: T-0455
title: "AI memory: when remember saves a fact, the reply ends with a plain 'Remembered: <fact>' line"
status: merged
milestone: M5
branch: task/T-0455-memory-remembered-line
model: auto
effort: low
depends_on: [T-0444]
estimate: 0.15 day
---

# T-0455: show what the AI pinned

## Spec (written by Claude, do not edit)

### Why
When the AI pins a fact with `remember`, nobody in the chat sees it unless they open the memory panel. The persona tools already add a fixed line to the reply, and memory should do the same. The line is plain text: Julio wants no emoji in the app.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/reply.ts`:**
  - `ToolExecution { content; notice? }` (lines 84-95);
  - notices are collected per call (lines 540-564) and appended to the final text, both in DMs (for example `loop.text + loop.notices.join('')` at line 1035) and in rooms (line 1398, plus the failure paths at 1351-1386).
- **`apps/server/src/agents/tools.ts`:**
  - `formatPersonaUpdatedLine(summary)` (lines 362-365) returns a line that starts with `\n\n`;
  - `sanitizeSummary` (line 371) strips control characters, collapses whitespace and caps at 200.
- **`apps/server/src/agents/gateway.ts:749-753`:** the `remember` branch returns `{ content: 'ok' }` on `saved`.
- **Tests:** `apps/server/src/agents/gateway.test.ts` has the T-0444 tests where the model calls `remember` ("The launch is on Friday."); `tools.test.ts` tests the persona line helpers.

### What to build
1. **`tools.ts`:** export `formatRememberedLine(text: string): string`. It returns `` `\n\nRemembered: ${clean}` ``, where `clean` is the text with control characters turned into spaces, whitespace collapsed and trimmed (the same steps as `sanitizeSummary`), capped at 280. **No emoji.**
2. **`gateway.ts`:** on `saved`, return `{ content: 'ok', notice: formatRememberedLine(call.text) }`. Nothing for `duplicate`, `invalid` or `refused`.
3. **Tests:**
   - `tools.test.ts`: the exact output; a newline and a tab inside become spaces; a 300-character input is capped at 280 characters after the prefix.
   - `gateway.test.ts`: in the existing DM `remember` test, the reply sent to the owner ends with `\n\nRemembered: The launch is on Friday.`. A duplicate `remember` adds no line. One room test: a member's turn that saves a fact ends with the line too.

### Read first
`AGENTS.md`, `apps/server/src/agents/tools.ts:355-385`, `apps/server/src/agents/reply.ts:84-95` and `:540-564`, `apps/server/src/agents/gateway.ts:725-760`, the `remember` tests in `apps/server/src/agents/gateway.test.ts` (`grep -n "remember" apps/server/src/agents/gateway.test.ts`).

### Allowed files
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools.test.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0455-memory-remembered-line.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/gateway
pnpm gate
```

### Acceptance
- A saved fact adds one plain `Remembered: <fact>` line to the reply in DMs and rooms. Refused or duplicate facts add nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review

### What I did
- `tools.ts`: added `REMEMBERED_FACT_MAX_LENGTH = 280` and exported `formatRememberedLine(text)`, which returns `\n\nRemembered: <clean>` (plain text, no emoji). Extracted the sanitize loop into a private `sanitizeLine(text, maxLength)`; `sanitizeSummary` now delegates to it with its existing 200 cap, so its behavior is unchanged.
- `gateway.ts`: the `remember` branch now returns `{ content: 'ok', notice: formatRememberedLine(call.text) }` on `saved`. `duplicate` (`already remembered`), `invalid` and `refused` return no notice, so the line is appended once per saved fact on both the DM and room reply paths.
- Tests added: exact `formatRememberedLine` output, control characters/newlines/tabs collapsed to spaces, and a 300-character input capped to 280 characters after the prefix (`tools.test.ts`); DM reply ends with `noted\n\nRemembered: The launch is on Friday.`, a duplicate fact adds no line, and a member's room turn that saves a fact gets `@Ana noted\n\nRemembered: The launch is on Friday.` (`gateway.test.ts`).

### Files changed
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tools.test.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway.test.ts`
- `work/T-0455-memory-remembered-line.md` (status + this report)

### Commands run
- `pnpm install` → done, 1170 packages, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/gateway` → `Test Files 2 passed (2)`, `Tests 174 passed (174)`, exit 0.
- `pnpm gate` (repo root), summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (13.2s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (7.0s)`
  - `PASS  tests @zilar/server  (33.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations from the spec
- The existing DM `remember` test asserted the fact never appeared in the combined logs *and* the sent reply. The spec now requires the fact in the reply, so I narrowed that assertion to the logger only (`JSON.stringify(logger.calls)` must not contain the fact) and added the reply assertion. The "without logging the text" guarantee is preserved.

### Blocked / needs a decision
None. No new dependencies. No files touched outside the Allowed list.

## Review (written by Claude)

Approved (lead, 2026-10-07). formatRememberedLine adds a plain "Remembered: <fact>" line (sanitized, capped at 280, no emoji) as a notice on a saved fact, so it rides on DM and room replies. Duplicate or refused facts add nothing. sanitizeSummary was refactored into a shared sanitizeLine. Pre-review clean.
