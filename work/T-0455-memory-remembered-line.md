---
id: T-0455
title: "AI memory: when remember saves a fact, the reply ends with a plain 'Remembered: <fact>' line"
status: todo
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

## Review (written by Claude)
