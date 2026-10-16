---
id: T-1766
title: "Tool cards match the board: a saved tool may set its card's title, icon and meta; tool.run titles default to a readable name; the sandbox gets a fmt helper (QuickJS has no Intl); the tool guide shows the board's prices example"
status: merged
milestone: M5
branch: task/T-1766-tool-card-header
model: auto
effort: default
depends_on: [T-1765]
estimate: 45 min
---

# T-1766: Tool cards that match the board

## Spec (written by Claude, do not edit)

### Why
Julio's live test (2026-10-16, 22:34 UTC) worked, but he asked why the card doesn't look like the approved board `docs/design/mockups/blocks/Main.dc.html`, whose "Prices" card has:
- an icon, the title "Prices" and `daily 09:00` in its header;
- the rows `BTC $82,302 ▲ 2.1%`, `Gold $4,152 ▼ 0.3%` and `S&P 500 7,744 ▲ 0.4%`.

The live card had the title `market-prices`, no icon, no meta, unformatted values (`$81658.84`, `$4164.385/oz`), no change column, and an "As of …" callout row. The causes:
1. **A tool can't set its card's header.** `tool.run` builds `buildBlocksPayload({ title: found.name, blocks }, text)` (`apps/server/src/tools/tool-adapters.ts:286`), so the title is the tool's slug and there's no icon or meta. Routines use the routine title and schedule (`apps/server/src/routines/outcomes.ts:51-80`), with no icon.
2. **Tools can't format numbers.** Tools run in QuickJS (`apps/server/src/sandbox/tool-worker-vm.ts:3`), which has no `Intl`: `toLocaleString('en-US', { maximumFractionDigits: 2 })` ignores its options, so `4164.385` comes out unrounded and without grouping. The blocks contract says the client never formats; the tool sends exact strings (`packages/protocol/src/blocks-numbers.ts:26-31`).
3. **The guide the AIs read** (`apps/server/src/agents/tool-guide.ts:27`) never shows a figure row's `change: { direction: 'up' | 'down' | 'flat', text }` (`blocks-numbers.ts:28-31`), or that the time belongs in the header's `meta`, not in a callout.

### Facts (read by the lead on 2026-10-17)
- **The tool output** is parsed in three places:
  - `toolOutputSchema` and `parseToolOutput` in `apps/server/src/sandbox/types.ts:48-70` (`blocks` passes through unchecked, `:63-68`);
  - `outputJsonSchema` in `apps/server/src/sandbox/run-tool-schemas.ts:45-49`;
  - the output type `{ text; data?; blocks? }` in `apps/server/src/tools/types.ts:13` (and `ToolOutput` in `sandbox/types.ts:~29`).
- **`buildBlocksPayload`** (`apps/server/src/message-blocks/build.ts:7-30`) takes `{ title?, icon?, meta?, blocks }` as `unknown` and validates them strictly against `BlocksDataSchema`: `title` Text, `icon` from `BlockIconSchema` (lucide names, `blocks-numbers.ts:35-…`), and `meta` ShortText (`packages/protocol/src/blocks.ts:81-83`).
- **The QuickJS globals** (`fetch`, `console`, `__zilar_input`) are set in `apps/server/src/sandbox/tool-worker.ts:98-119`, just before the tool source is evaluated with `evalInVm(params.source, true)` (`:121`). `evalInVm` comes from `createVmTools` (`tool-worker-vm.ts:97`). `tool-worker.ts` is 275 lines.
- **The docs:** `docs/TOOL_SANDBOX.md:1-20` describes the return shape.

### Steps
1. **The card header from a tool:** a tool may return `card?: { title?: string; icon?: string; meta?: string }` next to `text` and `blocks`.
   - Add it to `toolOutputSchema`, `outputJsonSchema` and both output types as `Schema.optional(Schema.Unknown)`, passed through unchecked like `blocks`.
   - Only `buildBlocksPayload` validates it. An invalid `card` makes the payload invalid, which falls back to plain text as today.
2. **`tool.run`:** build with `title: card?.title ?? readableToolName(found.name)`, `icon: card?.icon`, `meta: card?.meta`. `readableToolName('market-prices')` gives `'Market prices'`: hyphens and underscores become spaces, the first letter is upper case. Put it in a small helper in `tool-adapters.ts`, or a new `apps/server/src/tools/card-header.ts` if the file would pass 400 lines.
3. **Routines:** `routineBlocksPayload` keeps the routine title and the schedule meta (that is the board), and adds `icon: card?.icon`. Thread `card` the way `outputBlocks` is threaded today.
4. **`fmt` in the sandbox:** a new `apps/server/src/sandbox/tool-prelude.ts` exports a plain-JS source string. `tool-worker.ts` evaluates it once, after the globals and before the tool source. It defines a frozen global `fmt` with:
   - `fmt.number(n, digits = 2)`: `7744.1` with digits 0 gives `"7,744"`; with 2, `"7,744.10"`;
   - `fmt.money(n, symbol = '$', digits = 2)`: gives `"$82,302.00"`; with digits 0, `"$82,302"`;
   - `fmt.change(now, before, digits = 1)`: gives `{ direction: 'up' | 'down' | 'flat', text: '2.1%' }`, the absolute percent (the arrow comes from `direction`). It is `flat` when the rounded value is 0.
   - Grouping is done by hand (no `Intl`). A non-finite number gives `"—"`.
   - Keep the prelude small; it runs inside the tool's CPU and memory limits.
5. **The guide and docs:**
   - Replace `tool-guide.ts:27` with a line saying a saved tool returns a string or `{ text, blocks?, card? }`; `card` sets the header (`title`, `icon`, `meta`, where meta is a short time or date such as `22:34 UTC`); values must be pre-formatted strings, so use the sandbox's `fmt.money`, `fmt.number` and `fmt.change`; a figure row can carry `change` from `fmt.change(now, previous)`; and the time goes in `card.meta`, not a callout.
   - In `docs/TOOL_SANDBOX.md`, add a short "Cards" section with the board's prices example in code: a figure with three rows, each with `change`, plus `card: { title: 'Prices', icon: <a valid BlockIconSchema name, pick the closest to a chart>, meta: '22:34 UTC' }`.
6. **Tests (the message pipeline, 2):**
   - in `apps/server/src/sandbox/run-tool.test.ts`, a tool returning `{ text, blocks, card: { title: 'Prices' } }` that uses `fmt.money(82302, '$', 0)` and `fmt.change(105, 100)` gets output with `card` kept and the values `"$82,302"` and `{ direction: 'up', text: '5.0%' }`;
   - `readableToolName('market-prices') === 'Market prices'`, in the same file or next to the helper.

### Allowed files
- `apps/server/src/sandbox/types.ts`
- `apps/server/src/sandbox/run-tool-schemas.ts`
- `apps/server/src/sandbox/tool-worker.ts`
- `apps/server/src/sandbox/tool-prelude.ts`
- `apps/server/src/sandbox/run-tool.test.ts`
- `apps/server/src/tools/types.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/tools/card-header.ts`
- `apps/server/src/routines/outcomes.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/agents/tool-guide.ts`
- `docs/TOOL_SANDBOX.md`
- `work/T-1766-tool-card-header.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/sandbox/run-tool.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A saved tool can set its card's title, icon and meta.
- `tool.run` without `card` titles the card "Market prices", not "market-prices".
- `fmt.money`, `fmt.number` and `fmt.change` work inside tools.
- The guide tells the AI how to make the board's prices card.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

Implemented the whole spec.

1. **`card` on the tool output.** Added `card?: unknown` to `ToolOutput`
   (`sandbox/types.ts`), `toolOutputSchema`, `outputJsonSchema`
   (`sandbox/run-tool-schemas.ts`) and the runner output type
   (`tools/types.ts`). `parseToolOutput` keeps it unchecked, exactly like
   `blocks`; only `buildBlocksPayload` validates it.
2. **`tool.run` header.** New `apps/server/src/tools/card-header.ts` with
   `cardHeader(card)` (safe read of `title`/`icon`/`meta` from an unknown
   card) and `readableToolName(name)` (hyphens/underscores → spaces, first
   letter upper case). `tool.run` now builds with
   `title: card.title ?? readableToolName(found.name)`, `icon: card.icon`,
   `meta: card.meta`.
3. **Routines.** `routineBlocksPayload` keeps the routine title and schedule
   meta and adds `icon: cardHeader(card).icon`. `execute.ts` reads
   `result.output.card` and threads it through `postResult` (new optional 6th
   param, so the existing 5-arg callers stay valid).
4. **`fmt` prelude.** New `apps/server/src/sandbox/tool-prelude.ts` exports the
   plain-JS source string `TOOL_PRELUDE`. `tool-worker.ts` evaluates it once
   after the globals and before the tool source, installing a frozen global
   `fmt` with `number`, `money` and `change`; grouping/rounding is done by hand
   (no `Intl`), a non-finite number gives `—`.
5. **Guide and docs.** Rewrote the `tool-guide.ts` tool-output line to describe
   `{ text, blocks?, card? }`, `card.meta` vs a callout, and the `fmt` helpers.
   Added a "Cards" section to `docs/TOOL_SANDBOX.md` with the board's prices
   example (figure with three rows, each with `change`, and
   `card: { title: 'Prices', icon: 'chart', meta: '22:34 UTC' }`).
6. **Tests.** In `sandbox/run-tool.test.ts`: a tool returning
   `{ text, blocks, card: { title: 'Prices' } }` that uses
   `fmt.money(82302, '$', 0)` and `fmt.change(105, 100)`, asserting the card
   is kept and the values are `"$82,302"` and
   `{ direction: 'up', text: '5.0%' }`; a `fmt` edge-case test
   (`number`/`money` grouping, `flat`/`down` changes, `NaN` → `—`, frozen);
   and `readableToolName('market-prices') === 'Market prices'`.

Changed files (all inside Allowed files):
`apps/server/src/sandbox/types.ts`,
`apps/server/src/sandbox/run-tool-schemas.ts`,
`apps/server/src/sandbox/tool-worker.ts`,
`apps/server/src/sandbox/tool-prelude.ts` (new),
`apps/server/src/sandbox/run-tool.test.ts`,
`apps/server/src/tools/types.ts`,
`apps/server/src/tools/tool-adapters.ts`,
`apps/server/src/tools/card-header.ts` (new),
`apps/server/src/routines/outcomes.ts`,
`apps/server/src/routines/execute.ts`,
`apps/server/src/agents/tool-guide.ts`,
`docs/TOOL_SANDBOX.md`,
`work/T-1766-tool-card-header.md`.

### Checks run

Single test files while working:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts`
  → 1 file passed, 51 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/blocks-post.test.ts`
  → 1 file passed, 2 tests passed (covers the `postResult` signature change).

`pnpm gate` (from the repo root) summary:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (3.4s)
PASS  effect  (0.9s)
PASS  tests @zilar/server  (28.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Deviations (small): I put `readableToolName` in the new
  `tools/card-header.ts` together with `cardHeader`, instead of
  `tool-adapters.ts`, because `routines/outcomes.ts` also needs to read
  `card.icon` and should not import the adapter module. Both files are listed
  in Allowed files.
- `postResult` gained an optional 6th `outputCard?: unknown` parameter so the
  existing 5-argument callers in `routines/blocks-post.test.ts` (not an
  Allowed file) keep working.
- The stale error strings in `sandbox/run-tool.ts` still say
  `{ text, data?, blocks? }`; that file is not in Allowed files, so I left it
  alone.
- The extra `fmt` edge-case test is beyond the two tests named in the spec, but
  stays inside the same Allowed test file.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `5fb4f0544`.
- `card` passes through the sandbox unchecked, like `blocks`, and only `buildBlocksPayload` validates it.
- `tool.run` uses `card.title ?? readableToolName(name)`, plus `card.icon` and `card.meta`.
- Routines keep their title and schedule meta and gain `card.icon`.
- The `fmt` prelude (number, money, change) groups digits by hand and rounds with `toFixed`.
- The guide line and the "Cards" section in `docs/TOOL_SANDBOX.md` are updated.
- I ran `run-tool.test.ts` and `src/tools`: 58 passed.
- **Nit, accepted:** `fmt.money(-5)` prints `$-5.00`.
- **Follow-up:** the `run-tool.ts` error strings still say `{ text, data?, blocks? }`. That's for the cards pass, along with date helpers, a shared card guide and card checks on `tool.save` (Julio, 10-17: "jack-of-all-trades").

