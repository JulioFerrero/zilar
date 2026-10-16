---
id: T-1759
title: "Blocks B7: a saved tool may return blocks; a tool routine's post then carries a blocks card (header = routine title + schedule), falling back to plain text when the blocks are invalid"
status: merged
milestone: M5
branch: task/T-1759-blocks-tool-output
model: auto
effort: default
depends_on: [T-1749, T-1751]
estimate: 40 min
---

# T-1759: Saved tools and tool routines post block cards

## Spec (written by Claude, do not edit)

### Why
The main use of message blocks is a daily routine like "Prices": a saved tool fetches the data, and the routine posts it every morning with no model call. The board is `docs/design/mockups/blocks/Main.dc.html:52-71`: a "Prices" card whose header is the routine title plus "daily 09:00". The plan is `docs/plan/message-blocks.md` §2(b)(c), task B7.

This task lets a saved tool return `blocks` and makes the tool routine post them as a `blocks` card. Prompt routines (an AI turn) get blocks through the `post_blocks` tool (T-1758), not here.

### Facts (read by the lead on 2026-10-16)
- **Saved-tool output:**
  - `ToolOutput` is at `apps/server/src/sandbox/types.ts:26`;
  - `toolOutputSchema = Schema.Struct({ text: Schema.String, data: Schema.optional(Schema.Unknown) })` is at `:47-50`;
  - `parseToolOutput` (`:52-64`) returns `{ text }` or `{ text, data }`;
  - the runner port's type repeats it: `apps/server/src/tools/types.ts:13` (`output: { text: string; data?: unknown }`).
  - The doc is `docs/TOOL_SANDBOX.md:13-16` ("`{ text: string, data?: JSON }`").
- **Tool routine run** (`apps/server/src/routines/execute.ts`, 222 lines):
  - it keeps only `outputText = result.output.text` (`:178-189`), then calls `postResult(ports, options, row, outputText)` (`:212-215`);
  - `postResult` (`apps/server/src/routines/outcomes.ts:22-42`) posts `${row.title}\n${truncateChars(outputText, MAX_POST_TEXT_CHARS)}` through `ports.post({ aiId, groupId, topicId?, text })`.
- **The `post` port type** is declared in `apps/server/src/routines/execute.ts:69-74`, `apps/server/src/routines/wiring.ts:25-30` and `apps/server/src/tools/adapter-support.ts:23-28`. Grep for others.
  - In production it's the gateway's `postToChat`, which **already accepts `payload?: Payload`** (`apps/server/src/agents/gateway/contracts.ts:271-277`, `apps/server/src/agents/gateway/live.ts:325-333`).
- **The builder:** `buildBlocksPayload({ title?, icon?, meta?, blocks }, fallback)` returns `{ ok: true; payload } | { ok: false; reason }` and never throws (`apps/server/src/message-blocks/build.ts`).
- **The schedule text** ("daily 09:00"): `describeSchedule(parsed.value)`, after `parseRoutineSchedule(routine.schedule)` returns `ok` (used the same way in `apps/server/src/agents/gateway/routine-send.ts:43-56`; imports from `../../routines/schedule` and `../../tools/routine-adapters`).
- **The model's tool guide:** `apps/server/src/agents/tool-guide.ts` (92 lines). Its line `:26` tells the AI to use saved tools for recurring data jobs, but nothing says what a tool returns.
- **Wave 1 clients render** `figure`, `number`, `checklist`, `status`, `link` and `callout` (T-1755, T-1756).

### Steps
1. **Output shape:** add `blocks: Schema.optional(Schema.Unknown)` to `toolOutputSchema`, and `blocks?: unknown` to `ToolOutput` and to `apps/server/src/tools/types.ts:13`.
   - `parseToolOutput` passes `blocks` through untouched when present. It's checked later by `buildBlocksPayload`, so a broken tool never breaks its run.
2. **The routine post:** keep `result.output.blocks` next to `outputText` in `execute.ts` and pass it to `postResult`. In `postResult`:
   - when `blocks !== undefined`, call `buildBlocksPayload({ title: row.title, meta: <schedule text, if it parses>, blocks }, outputText)`;
   - **if `ok`,** post with `text` unchanged (today's `"<title>\n<text>"`, so previews, push and old clients keep working) plus `payload`;
   - **otherwise,** post plain text exactly as today, and log `{ routineId }` with the message 'routine blocks invalid', never the reason text.
   - Add the optional `payload?: Payload` to every `post` port type.
3. **The guide:** add one line to the tool guide in `tool-guide.ts`. A saved tool returns a string or `{ text, blocks? }`; `blocks` uses the same kinds as `post_blocks` (figure, number, checklist, status, link, callout) with pre-formatted string values, and a routine then posts it as a card.
4. **The doc:** update `docs/TOOL_SANDBOX.md:13-16` to `{ text: string, data?: JSON, blocks?: Block[] }`, with one sentence on what `blocks` does.
5. **One test (the message pipeline)** in a new `apps/server/src/routines/blocks-post.test.ts`. Call `postResult` with a fake `post` that records its input:
   - valid `figure` blocks give one post with `payload.type === 'blocks'`, `payload.data.title === row.title` and the plain text unchanged;
   - an `http://` link block gives one plain post with no payload.
   - At most 2 tests.

### Allowed files
- `apps/server/src/sandbox/types.ts`
- `apps/server/src/sandbox/run-tool-schemas.ts` (lead, after the BLOCKED report: `outputJsonSchema` drops `blocks`)
- `apps/server/src/sandbox/run-tool.ts` (lead: the three `{ text, data }` messages)
- `apps/server/src/tools/types.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/outcomes.ts`
- `apps/server/src/routines/wiring.ts`
- `apps/server/src/routines/scheduler.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/routines/blocks-post.test.ts`
- `docs/TOOL_SANDBOX.md`
- `work/T-1759-blocks-tool-output.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/routines/blocks-post.test.ts src/routines/execute.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A saved tool that returns valid `blocks` makes its routine post a `blocks` card (header: the routine title plus the schedule) with the same plain text as today.
- Invalid blocks fall back to today's plain post.
- The guide and the doc mention `blocks`. The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

All Spec steps are done inside the Allowed files:

1. **Output shape** — `apps/server/src/sandbox/types.ts`: added `blocks?: unknown` to `ToolOutput` and `blocks: Schema.optional(Schema.Unknown)` to `toolOutputSchema`; `parseToolOutput` now passes `blocks` through untouched when present. `apps/server/src/tools/types.ts`: added `blocks?: unknown` to the runner's ok output.
2. **The routine post** — `apps/server/src/routines/execute.ts` keeps `result.output.blocks` next to `outputText` and passes it to `postResult`. `apps/server/src/routines/outcomes.ts`: `postResult` now takes `outputBlocks: unknown`, and `routineBlocksPayload` builds `buildBlocksPayload({ title: row.title, meta: <describeSchedule(parsed) when the schedule parses>, blocks }, outputText)`. When `ok`, the post carries `payload` and the plain text (`"<title>\n<text>"`) unchanged; otherwise it posts plain text and logs `{ routineId }` with `'routine blocks invalid'` (never the reason). Added `payload?: Payload` to the three `post` port types in `execute.ts`, `routines/wiring.ts` and `tools/adapter-support.ts`.
3. **The guide** — `apps/server/src/agents/tool-guide.ts`: one new line saying a saved tool returns a string or `{ text, blocks? }`, that `blocks` uses the same kinds as `post_blocks` (figure, number, checklist, status, link, callout) with pre-formatted string values, and that a routine posts it as a card.
4. **The doc** — `docs/TOOL_SANDBOX.md:13-19`: the return shape is now `{ text: string, data?: JSON, blocks?: Block[] }`, with one sentence on what `blocks` does.
5. **One test** — new `apps/server/src/routines/blocks-post.test.ts` (2 tests, calls `postResult` with a recording `post`): valid `figure` blocks give one post with `payload.type === 'blocks'`, `payload.data.title === row.title` and the plain text unchanged; an `http://` link block gives one plain post with no payload. The first test also asserts that `Schema.decodeUnknownSync(outputJsonSchema)` keeps `blocks`, so the sandbox decode cannot silently drop them again.
6. **The sandbox decode** (lead's follow-up after the BLOCKED report) — `apps/server/src/sandbox/run-tool-schemas.ts`: added `blocks: Schema.optional(Schema.Unknown)` to `outputJsonSchema`, the decode `run-tool.ts` runs before `parseToolOutput`, so a real tool's `blocks` reach the routine. `apps/server/src/sandbox/run-tool.ts`: the fixed `invalid_output` text is now `'tool must return a string or { text, data?, blocks? }'`. There are four occurrences (not three: `:237`, `:249`, `:269`, `:280`); all four were updated so no stale message remains.

### Checks run

- `pnpm install`: Done in 22.7s (`reused 1144, added 1151, done`); one pre-existing peer warning (`@types/react-dom` vs `@types/react` in `apps/mobile`), unrelated to this task.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/blocks-post.test.ts src/routines/execute.test.ts`: `Test Files 2 passed (2)` / `Tests 3 passed (3)` (3.02s).
- `pnpm gate` (repo root): final run ends **GATE PASS**. Summary lines:
  - `gate: 12 changed file(s) against main`
  - `PASS install (frozen) (1.1s)`, `PASS format (1.1s)`, `PASS lint (0.8s)`, `PASS typecheck (2.7s)`, `PASS effect (0.5s)`, `PASS tests @zilar/server (31.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - An earlier gate run FAILED only `format` on the new test file; fixed by running Prettier on that one file. Every run since has been green.
- The gap first raised in a BLOCKED report — `outputJsonSchema` dropping `blocks` before `parseToolOutput` — is fixed: the lead added `apps/server/src/sandbox/run-tool-schemas.ts` and `apps/server/src/sandbox/run-tool.ts` to Allowed files, and steps 6 above close it end to end.

### Notes for the lead

- Plan §2(b) (`docs/plan/message-blocks.md:273-277`) says `parseToolOutput` should validate blocks through `BlockSchema` and drop them when invalid; the task Spec (governing) says pass them through untouched and let `buildBlocksPayload` check them. I followed the Spec.
- When the routine's `schedule` does not parse, `meta` is omitted and the payload is still built from title + blocks. No dedicated test for that path (kept to the two tests the Spec allows).
- No DB or route changes. The invalid path logs ids only (`{ routineId }`), so no blocks/output text reaches logs.

## Review (written by Claude)

- **Accepted at `a2ebfd007`.** It's clean, with no nits. The lead ran `blocks-post.test.ts` and `execute.test.ts`: 3 pass.
- **The worker's BLOCKED report was right:** `outputJsonSchema` in `sandbox/run-tool-schemas.ts` dropped `blocks` before `parseToolOutput`. The lead allowed that file and `run-tool.ts`, and `blocks` now survives the sandbox decode; a test asserts it.
- **The routine post:** valid blocks ride as a `blocks` payload. The header is the routine title, and the meta is `describeSchedule` when the schedule parses. The body text is unchanged (`"<title>\n<text>"`), so previews, push and old clients are as before.
  - Invalid blocks fall back to the plain post and log only the routine id.
- **The tool guide line and `docs/TOOL_SANDBOX.md`** now name `blocks`.
