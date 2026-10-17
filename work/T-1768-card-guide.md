---
id: T-1768
title: "Cards pass: one shared card guide (rules + every drawn kind's fields) used by post_blocks and the tool guide; fmt date/time/ago/duration helpers; tool.save tells the AI whether its card is valid"
status: merged
milestone: M5
branch: task/T-1768-card-guide
model: auto
effort: default
depends_on: [T-1766]
estimate: 45 min
---

# T-1768: One card guide for every request

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17): "this is just one simple case, we really have to have all this in a jack-of-all-trades not only workin in this prices example". Today:
- the AI learns cards only from one paragraph in the `post_blocks` description, whose example is prices;
- tools get one line in the tool guide;
- a tool's broken card silently becomes plain text, and the AI never learns why.

This task writes **one general card guide** that both paths use, adds date and time helpers next to T-1766's number helpers, and makes `tool.save` report the card.

**The lead holds this merge** until the web renderers for the new kinds have merged (the group tasks after T-1767). That way the AI is never offered a kind the web can't draw.

### Facts (read by the lead on 2026-10-17)
- **`post_blocks`:** `POST_BLOCKS_DESCRIPTION` (`apps/server/src/agents/tools/blocks-tool.ts:9-20`, 50 lines) lists six kinds with their fields. Its parameters (`:27-47`) cap `blocks` at `maxItems: 6`, while `MAX_BLOCKS = 12` (`packages/protocol/src/blocks-numbers.ts:9`).
- **The tool guide:** `TOOL_GUIDE_LINES` (`apps/server/src/agents/tool-guide.ts`, 93 lines). The card line, rewritten by T-1766, sits near `:27`. The guide is added as a user turn by `withToolGuide` (`apps/server/src/agents/gateway/tool-exec.ts:264-271`) whenever tools are on, in a DM or a group.
- **The kinds and their fields:**
  - numbers in `packages/protocol/src/blocks-numbers.ts` (`figure :92`, `number :108`, `stats :124`, `table :141`, `bars :165`, `line :183`, `gauge :200`);
  - progress in `blocks-progress.ts` (`checklist :6`, `progress :35`, `timeline :46`, `countdown :74`, `status :84`);
  - content in `blocks-content.ts` (`link :6`, `place :28`, with `map` and `url` optional; `weather :39`; `event :62`; `callout :88`).
  - The caps are `MAX_TEXT 120`, `MAX_SHORT 40` and `MAX_ROWS 24` (`blocks-numbers.ts:9-13`).
- **The sandbox prelude:** `TOOL_PRELUDE` (`apps/server/src/sandbox/tool-prelude.ts`, 49 lines) defines `fmt.number`, `fmt.money` and `fmt.change`. QuickJS has no `Intl`, but `Date` and its UTC getters work.
- **`tool.save`'s test run** (`apps/server/src/tools/tool-adapters.ts:177-209`) puts `result.output.text` into `modelText` on success. It never checks `blocks` or `card`.
  - `apps/server/src/tools/card-header.ts` (24 lines) has `cardHeader(card)` and `readableToolName(name)`.
  - `buildBlocksPayload(input, fallback)` (`apps/server/src/message-blocks/build.ts`) returns `{ ok: false, reason }` for a bad card.
- **The sandbox error strings** in `apps/server/src/sandbox/run-tool.ts` still say `'tool must return a string or { text, data?, blocks? }'` (`:237,249,269,280`). That's a T-1766 follow-up.

### Steps
1. **The guide module:** a new `apps/server/src/message-blocks/guide.ts` exports:
   - `CARD_KINDS: readonly Block['kind'][]`, the kinds the apps draw:
     - `figure`, `number`, `stats`, `table`, `bars`, `line`, `gauge`;
     - `checklist`, `progress`, `timeline`, `countdown`, `status`;
     - `link`, `place`, `weather`, `event`, `callout`.
   - `CARD_RULES: string`, the general rules, kept short:
     1. a card is a header plus 1–6 blocks;
     2. always set `title` (2–4 words naming the subject, never a tool name), an `icon` and `meta` (a short time, date, schedule or source, for example `daily 09:00`, `Fri 17 Oct`, `Live`);
     3. choose the kind by the data's shape (the map below);
     4. every value is a final display string (`$82,302`, `18°`, `2.1%`, `Fri 17 Oct`), never a raw number or ISO date, except the fields that are numbers by contract (`points`, `series[].value`, `ratio`);
     5. a change is `change: { direction: up|down|flat, text }` with the absolute value, and the arrow comes from `direction`;
     6. the time and source go in `meta`, never in a callout; a callout is only for a warning or a note the reader must act on;
     7. `text` is a one-line plain summary for notifications.
   - **The shape map** inside `CARD_RULES`:

     | The data | The kind |
     |---|---|
     | a few labelled values | `figure` |
     | one headline value (with a trend) | `number` (with `points`) |
     | 2–6 key figures as tiles | `stats` |
     | rows × columns | `table` |
     | a value per category | `bars` |
     | a series over time | `line` |
     | a share of a limit | `gauge`, or `progress` for a task |
     | ordered steps | `timeline` |
     | a deadline | `countdown` |
     | the health of several things | `status` |
     | to-dos | `checklist` |
     | a forecast | `weather` |
     | a meeting | `event` |
     | a location | `place` (no map) |
     | a web page | `link` |
     | one notice | `callout` |

   - `CARD_SHAPES: string`, one compact line per kind in `CARD_KINDS` with its exact fields, optionals marked `?`, written from the protocol files above (for example `kind=figure {rows:[{label,value,change?:{direction,text}}]}`).
   - `cardGuide(): string`, which returns `CARD_RULES + '\n' + CARD_SHAPES`.
2. **`post_blocks`:** its description becomes a one-line intro plus `cardGuide()`, and `blocks.maxItems` stays 6 (rule 1).
3. **The tool guide:** replace its card line with a line saying a saved tool returns `{ text, blocks?, card?: { title, icon, meta } }` and that its card follows these rules, followed by `cardGuide()`.
   - Mention that `fmt.money`, `fmt.number`, `fmt.change`, `fmt.date`, `fmt.time`, `fmt.ago` and `fmt.duration` exist in the sandbox.
   - The prelude stays the single source of what `fmt` does.
4. **The date helpers in `TOOL_PRELUDE`** (all UTC, no `Intl`):
   - `fmt.date(value)` gives `"Fri 17 Oct"`;
   - `fmt.time(value, offsetMinutes = 0)` gives `"09:00"`;
   - `fmt.ago(value, now = Date.now())` gives `"just now"`, `"5 min ago"`, `"3 h ago"` or `"2 d ago"`;
   - `fmt.duration(ms)` gives `"45 s"`, `"12 min"` or `"1 h 20 min"`.
   - `value` is an ISO string or epoch milliseconds, and anything invalid gives `"—"`.
   - Keep the prelude under 120 lines.
5. **`tool.save` reports the card:** add a pure `describeToolCard(output: { text; blocks?; card? }, toolName): string | null` in `apps/server/src/tools/card-header.ts`.
   - With no `blocks`, it returns `null`.
   - Otherwise it runs `buildBlocksPayload({ title: card.title ?? readableToolName(toolName), icon, meta, blocks }, text)` and returns `card ok: <n> blocks (<kinds>)`, or `card invalid: <reason>`.
   - When a kind is not in `CARD_KINDS`, it says `card: <kind> is not drawn by the apps yet`.
   - `tool.save` appends that line to its `modelText` (and its `summary`) after a successful test run.
6. **Error strings:** `run-tool.ts` says `{ text, data?, blocks?, card? }`.
7. **Tests (the message pipeline, 2):**
   - `apps/server/src/message-blocks/guide.test.ts`: every kind in `CARD_KINDS` is a literal of `BlockSchema`, and appears in `CARD_SHAPES`;
   - `apps/server/src/tools/card-header.test.ts`: `describeToolCard` says `card ok` for the board's prices card, `card invalid: …` for a figure with no rows, and `null` without blocks.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `apps/server/src/message-blocks/guide.test.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/sandbox/tool-prelude.ts`
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/tools/card-header.ts`
- `apps/server/src/tools/card-header.test.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `docs/TOOL_SANDBOX.md`
- `work/T-1768-card-guide.md`

If a test elsewhere snapshots the `post_blocks` description or the tool guide text, stop and list it in the Report.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts src/tools/card-header.test.ts src/sandbox/run-tool.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- One guide drives `post_blocks` and the tool guide.
- The AI is told how to choose a kind for any data.
- `fmt` covers dates, times, relative times and durations.
- `tool.save` tells the AI whether its card is valid.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **One card guide** — new `apps/server/src/message-blocks/guide.ts` exports `CARD_KINDS` (the 17 kinds the apps draw), `CARD_RULES` (header rules + the data→kind shape map), `CARD_SHAPES` (one compact line per kind with its exact protocol fields, optionals marked `?`) and `cardGuide()` (`CARD_RULES + '\n' + CARD_SHAPES`).
- **`post_blocks`** — `blocks-tool.ts` description is now a one-line intro plus `cardGuide()`; `blocks.maxItems` stays 6.
- **The tool guide** — `tool-guide.ts`'s card line now says a saved tool returns `{ text, blocks?, card?: { title, icon, meta } }`, follows `cardGuide()`, and names all seven `fmt` helpers.
- **Date helpers** — `TOOL_PRELUDE` gained `fmt.date` (`"Fri 17 Oct"`), `fmt.time(value, offsetMinutes = 0)` (`"09:00"`), `fmt.ago(value, now = Date.now())` (`"just now"` / `"5 min ago"` / `"3 h ago"` / `"2 d ago"`) and `fmt.duration(ms)` (`"45 s"` / `"12 min"` / `"1 h 20 min"`); all UTC, no `Intl`, an invalid value gives `"—"`. The prelude is 95 lines (limit 120).
- **`tool.save` reports the card** — new pure `describeToolCard(output, toolName)` in `card-header.ts`: `null` without blocks, `card: <kind> is not drawn by the apps yet` for a kind outside `CARD_KINDS`, otherwise `card ok: <n> blocks (<kinds>)` or `card invalid: <reason>` via `buildBlocksPayload`. `tool-adapters.ts` appends the line to the test run's `modelText` and `summary` on success.
- **Error strings** — `run-tool.ts` now says `{ text, data?, blocks?, card? }` in all four places.
- **Docs** — `docs/TOOL_SANDBOX.md` documents the four new `fmt` helpers.
- **Tests** — new `guide.test.ts` (every `CARD_KINDS` entry is a `BlockSchema` literal and has a `CARD_SHAPES` line) and `card-header.test.ts` (`card ok` for the board's prices card, `card invalid: …` for a figure with no rows, `null` without blocks, plus the undrawn-kind message).

### Checks run

- `pnpm install` — done, clean (peer-dependency warning about `@types/react@19.3.0` is pre-existing).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/guide.test.ts src/tools/card-header.test.ts` — **2 files passed, 7 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts` — **1 file passed, 51 tests passed** (fmt + card regressions clean).
- One-off `node --import tsx` eval of `TOOL_PRELUDE` (not committed) confirmed: `date('2025-10-17T09:00:00Z')='Fri 17 Oct'`, `time(...,120)='11:05'`, `ago` = just now/5 min/3 h/2 d, `duration(80*60000)='1 h 20 min'`, invalid = `—`.
- `pnpm gate` from the repo root:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.6s)
PASS  lint  (1.0s)
PASS  typecheck  (3.7s)
PASS  effect  (1.8s)
PASS  tests @zilar/server  (34.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- No test elsewhere snapshots the `post_blocks` description or the tool guide text (searched `apps/server/src/**/*.test.ts` for `POST_BLOCKS_TOOL_DEF`, `TOOL_GUIDE`, `cardGuide` — only the new `guide.test.ts`).
- As the spec notes, the lead holds this merge until the web renderers for the new kinds land, so the AI is never offered a kind the web cannot draw.
- No files outside the Allowed list were touched.

### Round 2 (lead fix round)

Three details in the guide could make an AI build a card the server rejects, plus two nits. One commit each:

1. `T-1768: guide lists the valid icon names` — the icon list in `CARD_RULES` is built from `BlockIconSchema.literals.join('|')` (24 names), not hand-copied, so it cannot drift from the protocol.
2. `T-1768: guide offers only fillable fields` — `CARD_SHAPES` drops `map?` from `place` and `event`, and `calendar?` from `event` (a map is an uploaded media id no AI can make; `calendar` is Wave 2). `countdown` says `targetAt:ISO with offset`; `event` says `startAt:ISO with offset,endAt:ISO with offset`.
3. `T-1768: guide states the length limits` — a `CARD_RULES` line read from `MAX_TEXT` (120), `MAX_SHORT` (40) and `MAX_ROWS` (24): "`title` up to 120 characters; `meta`, values and other short labels up to 40; at most 24 rows in a list or table."
4. `T-1768: test name and the shape map sign` — the two loop tests in `guide.test.ts` are now one test named `every guide kind is a protocol kind and has a shape line` (both assertions kept); the shape map row reads `rows × columns`.

Checks after the round:

- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts src/tools/card-header.test.ts src/sandbox/run-tool.test.ts --reporter=dot` — **3 files passed, 57 tests passed**.
- A one-off `node --import tsx` check (not committed) confirmed the icon list equals `BlockIconSchema.literals.join('|')` (24) and that `cardGuide()` is 2639 characters.
- `pnpm gate`:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.8s)
PASS  effect  (1.0s)
PASS  tests @zilar/server  (48.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Note: nit 4 asked to rename the test; the two kind-loop tests were merged into one so its name ("is a protocol kind and has a shape line") matches both assertions it makes. Coverage is unchanged.

### Round 3 (lead fix round)

Two more guide traps:

1. `T-1768: guide names every number field` — rule 4 now also lists the line `min`/`max` as numbers by contract (`points`, `series[].value`, `ratio`, and `min`/`max` on a line), and `CARD_SHAPES` marks them `min?:number,max?:number` on `line` (`points:number[]` unchanged). This stops an AI following the rule from sending `"min": "0"` and getting `card invalid`.
2. `T-1768: tool guide keeps the plain-string return` — the tool-guide line now says a saved tool returns a plain string, or `{ text, blocks?, card? }`, matching `run-tool.ts`'s accepted output.

Checks after the round:

- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts src/tools/card-header.test.ts --reporter=dot` — **2 files passed, 6 tests passed**.
- `pnpm gate`:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
PASS  tests @zilar/server  (29.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The first `pnpm gate` failed on `format` for `guide.ts` (the round-1 line was reworded to avoid an escaped apostrophe); the fix was folded into the item-1 commit with a fixup rebase, so the history is still one commit per item. `guide.ts` is the only file changed by items 1 and 2 of this round, and item 1's commit now carries the formatted line.

### Round 4 (lead fix round)

One commit (`T-1768: guide spells exact datetime, id and field types`) so the guide's shapes match the protocol exactly, not approximately:

1. **Datetimes** — a new rule defines `datetime`: "ISO 8601 with seconds and offset, e.g. `2026-10-17T09:00:00+02:00`; the seconds and the offset are required (a plain `YYYY-MM-DD` or a missing offset fails the card)". `countdown.targetAt` and `event.startAt`/`endAt` now say `datetime` (were `ISO with offset`), and rule 4 now says "ISO 8601 date-time" instead of "ISO date".
2. **Ids** — a new rule for the `IdSchema` shape: "List `id` fields (checklist `id` and `items[].id`) use letters, digits and `.` `_` `~` `-` only, no spaces, e.g. `milk`, `step-2`."
3. **Untyped fields** — every shape line now annotates the fields that are not plain display strings, checked against the protocol: `figure.change?` and `number.change?` as `{direction:up|down|flat,text}`; `table.total?:boolean`; `bars.series[].current?:boolean`; `line.labels?:string[]`; `checklist.items[].done:boolean`; `stats.tiles[].ratio?:0..1`, `gauge.ratio:0..1`, `progress.ratio:0..1`; `timeline.steps[].state:done|current|todo`; `status.rows[].status:ok|warn|bad`; `callout.tone:...`. String arrays are written `string[]` (`columns`, `rows`, `labels`), object arrays as `[{…}]` (`tiles`, `series`, `items`, `steps`, `rows`, `hourly`), and `points:number[]`, `min`/`max:number`, `series[].value:number` were already typed.

Checks after the round:

- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot` — **1 file passed, 2 tests passed**.
- `pnpm gate`:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.3s)
PASS  lint  (1.2s)
PASS  typecheck  (3.0s)
PASS  effect  (0.7s)
PASS  tests @zilar/server  (30.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `2e2a91bfe`, after four rounds.
- **One guide** (`message-blocks/guide.ts`) feeds both `post_blocks` and the tool guide:
  - the 17 drawn kinds, each with an exact shape line;
  - the valid icon names;
  - datetimes as ISO with seconds and offset;
  - the id alphabet;
  - the number-by-contract fields (`points`, `series[].value`, `ratio`, line `min`/`max`).
- **`fmt`** gains date, time, ago and duration helpers.
- **`tool.save`** tells the AI whether its card is valid, and why not.
- I ran `guide.test.ts` and `card-header.test.ts`: 6 passed.
- **Nit, left open:** the guide says 1-6 blocks while tools accept 12. That's the safe direction.
- **Next:** the live cards test, about 20 varied requests in "cards test".



