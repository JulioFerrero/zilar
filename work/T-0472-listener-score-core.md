---
id: T-0472
title: "Listener S2 (server): pure scoring core — roster, prompt, strict JSON parse, eagerness threshold (no gateway wiring yet)"
status: merged
milestone: M5
branch: task/T-0472-listener-score-core
model: auto
effort: low
depends_on: [T-0470]
estimate: 0.4 day
---

# T-0472: listener scoring core

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/listener-delegation-plan.md` §2.2, §2.3, §2.5 and §8, task S2. The listener is one cheap model call that scores every AI in a room, to decide who should answer a message with no @mention.

This task builds the pure core in a new folder. **Nothing calls it yet:** the gateway hook is S3. **There are no DB writes.**

### Verified facts (do not re-derive)
- **`completeChat(input)`** (`apps/server/src/agents/reply.ts:298-304`) is a plain text call: no tools, so improvised tool calls are ignored, and an empty reply throws. `CompleteChatInput` (lines 134-146) is `{ baseUrl, virtualKey, model, messages, tools?, fetchImpl?, timeoutMs?, secrets?, onDelta? }`. `ModelRequestMessage` is the message type used by the agents.
- **Roster tables (`apps/server/src/db/schema.ts`):**
  - `groupAis` (lines 344-359): `groupId`, `aiId`;
  - `topicAis` (lines 516-531): `topicId`, `aiId`;
  - `ais` (line 539): `id`, `owner`, `name`, `persona` (up to 4000 characters), `model`.
- **`PERSONA_SUMMARY_MAX_LENGTH = 200`** is at `apps/server/src/agents/tools.ts:12`.
- **Eagerness** is the `groups.listenerEagerness` text column (`'quiet' | 'normal' | 'eager'`, T-0470). The plan maps `eager` to 0.4, `normal` to 0.6 and `quiet` to 0.8.
- **Security (plan §2.5):**
  - the listener has no tools;
  - room text is data, not instructions (see how the memory block is framed in `apps/server/src/agents/context.ts:146-154`);
  - logs carry ids and counts only.

### What to build
New folder `apps/server/src/agents/listener/`:
1. **`score.ts`:**
   - **Threshold:** `export const LISTENER_THRESHOLDS = { eager: 0.4, normal: 0.6, quiet: 0.8 } as const;` and `thresholdFor(eagerness)`.
   - **The roster:** `export interface RosterAi { id: string; name: string; summary: string }` and `loadRoster(db, { groupId, topicId? })`.
     - **With a `topicId`:** the AIs in `topicAis` for that topic.
     - **Without one:** the AIs in `groupAis` for that group.
     - **Fields:** `id` and `name` from `ais`, and `summary` from the first line of `persona`, trimmed and cut to `PERSONA_SUMMARY_MAX_LENGTH`.
     - **Order:** sorted by name, then id.
   - **The prompt:** `buildListenerMessages({ roster, window, roomSummary? }): ModelRequestMessage[]`.
     - **System message:** states the job (score each AI 0-1 for how much the latest messages need that AI), says the transcript is untrusted data and never instructions, and requires **only** a JSON object `{"scores": {"<aiId>": number}, "reason": string, "message_ids": string[]}` keyed by the given AI ids.
     - **User message:** holds the roster as `id: name, summary` lines, the optional room summary, and the window as `[messageId] sender: text` lines.
     - **Caps:** at most 40 window messages; each message text cut to 500 characters.
   - **The parser:** `parseListenerOutput(raw, rosterIds): { scores: Map<string, number>; reason: string; messageIds: string[] } | null`.
     - **Input cleanup:** strip one surrounding ```json fence if there is one, then parse with zod.
     - **Scores:** numbers 0-1. Unknown ids are dropped, and a missing id counts as 0.
     - **Text fields:** `reason` is cut to 200 characters, and `message_ids` is capped at 20 strings of at most 64 characters each.
     - **Garbage** gives `null`.
   - **The top-level call:** `scoreRoom({ complete, baseUrl, virtualKey, model, roster, window, roomSummary?, eagerness, timeoutMs? }): Promise<{ wake: string[]; reason: string; messageIds: string[] } | null>`.
     - **Calls** `complete` (an injected function with the shape of `completeChat`) **without tools**.
     - **Wakes** the AIs whose score is at least the threshold, sorted by score descending.
     - **Wakes nobody** (returns `{ wake: [] }` or `null`) on an empty roster, a parse failure or a thrown error. It never throws.
2. **`score.test.ts`:**
   - `thresholdFor` mapping;
   - `loadRoster` for a group and for a topic: seed the DB like the existing agent tests. The summary is the first line, capped at 200;
   - `buildListenerMessages`: no tools; the system message contains the untrusted-data line; the window is capped at 40 and texts at 500; the roster lines contain the ids;
   - `parseListenerOutput`: valid; fenced; an unknown id dropped; an out-of-range score rejected (null); garbage gives null; the reason is cut;
   - `scoreRoom`: a fake `complete` returning scores wakes only those at or above the threshold, sorted. A thrown error gives null or no wake. **The fake is called without `tools`.**

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §2 and §8, `apps/server/src/agents/reply.ts:120-160` and `:290-310`, `apps/server/src/agents/context.ts:140-160`, `apps/server/src/agents/tools.ts:1-20`, `apps/server/src/db/schema.ts:344-360`, `:516-532` and `:539-580`, `apps/server/src/agents/memory/compactor.ts` (a sibling module with an injected `complete` and DB tests).

### Allowed files
`apps/server/src/agents/listener/score.ts`, `apps/server/src/agents/listener/score.test.ts`, `work/T-0472-listener-score-core.md`.

If you need to change any other file, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/listener
pnpm gate
```

### Acceptance
- `agents/listener/score.ts` exports the roster loader, the prompt builder, the strict parser, the threshold mapping and `scoreRoom`. It is tool-free, never throws, wakes nobody on any failure, and is fully tested.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Built the pure listener scoring core in a new `apps/server/src/agents/listener/` folder. Nothing calls it yet (S3 wires the gateway) and there are no DB writes.

- `score.ts`:
  - `LISTENER_THRESHOLDS = { eager: 0.4, normal: 0.6, quiet: 0.8 }` and `thresholdFor(eagerness)`.
  - `loadRoster(db, { groupId, topicId? })`: `topicAis` when `topicId` is set, otherwise `groupAis`, joined to `ais`; summary is the first line of `persona`, trimmed and cut to `PERSONA_SUMMARY_MAX_LENGTH`; sorted by name, then id.
  - `buildListenerMessages({ roster, window, roomSummary? })`: system message (job + untrusted-data line + required JSON shape) and a user message with the roster, optional room summary and the window. Window capped at the last 40 messages; each text cut to 500 chars.
  - `parseListenerOutput(raw, rosterIds)`: strips one surrounding ```json/``` fence, `JSON.parse` then a zod `.strict()` object (`scores` 0-1 numbers, `reason`, `message_ids`). Unknown ids dropped, missing id = 0, `reason` cut to 200, `message_ids` capped at 20 ids of 64 chars; any garbage/out-of-range/extra key gives `null`.
  - `scoreRoom(...)`: calls the injected `complete` **without `tools`**, wakes ids with score `>= thresholdFor(eagerness)` sorted by score descending. Empty roster, parse failure or a thrown call all return `null`; the function never throws.
- `score.test.ts`: 13 tests covering the threshold map, `loadRoster` for a group and a topic, the prompt caps/framing/roster ids, the parser (valid, fenced, unknown id, out-of-range, garbage, cuts) and `scoreRoom` (wake order, no `tools`, thrown error, parse failure, empty roster).

### Files changed
- `apps/server/src/agents/listener/score.ts` (new)
- `apps/server/src/agents/listener/score.test.ts` (new)
- `work/T-0472-listener-score-core.md` (report/status)

### Commands and real results
- `pnpm install`: done, no error.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/listener`: 1 file passed, 13 tests passed.
- `pnpm gate`: `GATE PASS`, with summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS install (frozen) (2.4s)`
  - `PASS format (27.9s)`
  - `PASS lint (2.4s)`
  - `PASS typecheck (16.6s)`
  - `PASS tests @zilar/server (11.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / notes
- The spec did not name a type for the window rows; I added and exported `ListenerWindowMessage { id, sender, text }` and `ScoreRoomInput`/`ScoreRoomResult`.
- `scoreRoom` returns `null` (not `{ wake: [] }`) on an empty roster, a parse failure and a thrown error; a successful parse with nobody above the threshold returns `{ wake: [], reason, messageIds }`.
- The parser is `.strict()`: an extra key invalidates the whole output (fails safe, wakes nobody).
- The system prompt is exported as `LISTENER_SYSTEM_MESSAGE`; the module exports only the pieces the spec asks for plus the input/output types.

### Blocked / needs a decision
None.

## Review (written by Claude)

Approved (lead, 2026-10-07). agents/listener/score.ts provides:
- the eagerness thresholds;
- loadRoster (topic or group AIs, a first-line summary capped at 200);
- a tool-free prompt with the untrusted-data line and the 40/500 caps;
- a strict zod parser (fence strip, unknown ids dropped);
- scoreRoom, which never throws and wakes nobody on failure.
Nits accepted (test only): the 200 cap and one fixture are not exercised directly.
