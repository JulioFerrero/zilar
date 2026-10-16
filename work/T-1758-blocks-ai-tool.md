---
id: T-1758
title: "Blocks B6: the post_blocks model tool - AIs post a blocks card in a group room (offered on every group turn, including routine runs); Wave 1 kinds only"
status: merged
milestone: M5
branch: task/T-1758-blocks-ai-tool
model: auto
effort: default
depends_on: [T-1749, T-1751]
estimate: 45 min
---

# T-1758: AIs post block cards (`post_blocks`)

## Spec (written by Claude, do not edit)

### Why
Message blocks (`docs/plan/message-blocks.md` §2(a), task B6) let an AI post a small native card. Julio wants AIs to use them "not just for prices".
- **The schema** (T-1749) and the server builder `buildBlocksPayload` (T-1751) are merged.
- **The web and phone renderers** for the first six kinds are being built (T-1755, T-1756).

This task gives the model a tool to post a card.
- **Offered:** on every group turn, routine runs included (a daily prices routine is the main use).
- **Not in this task:** DMs, a later task.

### Facts (read by the lead on 2026-10-16)
- **A new model tool touches all these files.** `ask_people` (T-1576) is the precedent; follow it file by file:
  - **The name:** `apps/server/src/agents/tools/schemas.ts:6-17` (`ASK_PEOPLE_TOOL = 'ask_people'`).
  - **The arguments:** a schema (`AskPeopleArgsSchema` at `schemas.ts:197-208`) and a `ParsedToolArguments` member (`:220-233`).
  - **The parse:** `apps/server/src/agents/tools/parse.ts` has a known-name guard (`:98-108`, add the name) and a decode branch (`:187-197`).
  - **The validated call:** `apps/server/src/agents/tool-calls.ts:219-221`, with its `ValidToolCall` member in `apps/server/src/agents/tool-loop.ts:64-66`.
  - **The barrel exports:** `apps/server/src/agents/tools.ts` (70 lines; `ASK_PEOPLE_TOOL` at `:10`, `ASK_PEOPLE_TOOL_DEF` at `:55`).
  - **The definition:** `ASK_PEOPLE_TOOL_DEF` at `apps/server/src/agents/tools/definitions.ts:256-280` (346 lines). `buildGroupTools` (`:330-346`) appends tools to every group turn.
  - **The executor:** `apps/server/src/agents/gateway/tool-exec.ts` (263 lines):
    - the group allow-list (`:133-141`) answers `invalid: unknown tool` for anything not listed;
    - the dispatch is at `:196-207` (`if (call.tool === ASK_PEOPLE_TOOL) { if (context === undefined) …; return yield* runAskPeopleEffect(session, call, { groupId, topicId, roomJid }) }`);
    - the runner is built from `createAskPeopleRunner(deps.db, logger, liveSendMessage)` (import at `:27`).
- **The runner to copy:** `apps/server/src/agents/gateway/ask-people.ts` (147 lines).
  - It posts with `send(session, chat.roomJid, 'groupchat', fallbackText, { payload: { v: 0, type: 'question', data } })` (`:89-95`).
  - `sent.id === ''` means the stop kill-switch dropped the send, so the model is told the post failed (`:73-76`, `:96-99`).
  - It logs only the AI id and the outcome, never the text (`:40-41`).
- **The builder:** `buildBlocksPayload(input: { title?, icon?, meta?, blocks }, fallback: string)` returns `{ ok: true; payload } | { ok: false; reason }` and never throws (`apps/server/src/message-blocks/build.ts`).
- **Wave 1 renders six kinds:** `figure`, `number`, `checklist` (read-only), `status`, `link` (https only) and `callout`. Their exact fields are in `packages/protocol/src/blocks-numbers.ts`, `blocks-progress.ts` and `blocks-content.ts`. The icon names are `BlockIconSchema` (`blocks-numbers.ts`).
  - Clients skip the other 19 kinds for now, so the tool must offer only these six.
- **The memory note `new-ai-tool-files`:** a new tool that misses one of these files fails at runtime (T-1576 was blocked by that). Grep `ASK_PEOPLE_TOOL` across `apps/server/src/agents` and cover every hit.

### Steps
1. **The tool definition:** a new `apps/server/src/agents/tools/blocks-tool.ts` exporting `POST_BLOCKS_TOOL_DEF`.
   - **`parameters`:** `text` (required, 1–1000, the plain summary people see in previews and notifications), `title?` (≤120), `icon?` (an enum of the `BlockIcon` names), `meta?` (≤40), and `blocks` (an array of 1–6 objects; `items: { type: 'object' }`). The server validates the real shape.
   - **The description** lists the six kinds with their fields, one compact line each. Example: `figure {rows:[{label,value,change?:{direction:up|down|flat,text}}]}`. Say that values are pre-formatted strings (`"$82,302"`), that links must be https, and to use it for numbers, lists and status, not for prose. Keep the description under about 900 characters.
2. **The name:** `export const POST_BLOCKS_TOOL = 'post_blocks'` in `schemas.ts`.
   - Add a `PostBlocksArgsSchema`: a strict struct with `text: string`, optional `title`, `icon` and `meta` strings, and `blocks: Schema.Array(Schema.Unknown)` with 1–6 items. Only the outer shape is checked here; `buildBlocksPayload` checks the blocks.
   - Add the `ParsedToolArguments` member.
3. **Parse and call:** a `parse.ts` known-name and decode branch; a `tool-calls.ts` branch; a `tool-loop.ts` `ValidToolCall` member `{ id; tool: typeof POST_BLOCKS_TOOL; text; title?; icon?; meta?; blocks: unknown[] }`; and the barrel exports in `tools.ts`.
4. **Offer it:** append `POST_BLOCKS_TOOL_DEF` in `buildGroupTools` (always; no flag).
5. **The runner:** a new `apps/server/src/agents/gateway/post-blocks.ts`, modelled on `ask-people.ts`, exporting `createPostBlocksRunner(logger, send)`.
   - It calls `buildBlocksPayload({ title, icon, meta, blocks }, text)`.
   - **On `ok: false`,** return `{ content: 'invalid: ' + reason }` so the model can fix it and retry.
   - **On `ok: true`,** send to `chat.roomJid` as `'groupchat'` with the body `payload.data.fallback` and `{ payload }`.
   - **An empty id** returns `'error: the card could not be posted'`.
   - **On success,** return `'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.'`
   - Log only the AI id, the tool and ok or the error name.
6. **The executor:** in `tool-exec.ts`, add `POST_BLOCKS_TOOL` to the group allow-list and a dispatch branch like `ask_people`'s (a DM, where `context === undefined`, answers `invalid: unknown tool`). Build the runner next to `createAskPeopleRunner`. Keep every touched file at most 400 lines.
7. **One test (the message pipeline)** in a new `apps/server/src/agents/gateway/post-blocks.test.ts`, with a fake `send` that records its arguments:
   - a valid call sends one `groupchat` message whose body is the trimmed `text` and whose payload type is `blocks`;
   - a call with an `http://` link sends nothing and returns content starting with `invalid:`.
   - Put both cases in one `it` if needed; at most 2 tests.

### Allowed files
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/tools/parse.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tool-calls.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `work/T-1758-blocks-ai-tool.md`

If another file turns out to need the new name (grep `ASK_PEOPLE_TOOL`), stop and say so in the Report instead of editing outside this list.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- Every group turn offers `post_blocks`.
- A valid call posts one `blocks` card with the plain fallback as its body; an invalid one returns a short reason and posts nothing.
- DMs don't get the tool yet. The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

Added the `post_blocks` model tool, following `ask_people` file by file:

- **`schemas.ts`**: `POST_BLOCKS_TOOL = 'post_blocks'`, the caps, `PostBlocksArgsSchema` (`text` trimmed 1-1000 required; optional `title` ≤120, `icon` ≤40, `meta` ≤40; `blocks` an unknown array of 1-6) and the `ParsedToolArguments` member.
- **`parse.ts`**: the known-name guard and the decode branch (optional keys are only spread when present).
- **`tool-calls.ts`**: the `toCall` branch folding the parsed shape into `ValidToolCall`.
- **`tool-loop.ts`**: the `ValidToolCall` member `{ text; title?; icon?; meta?; blocks: unknown[] }`.
- **`tools/blocks-tool.ts`** (new): `POST_BLOCKS_TOOL_DEF`, a ~520-character description naming the six Wave 1 kinds (`figure`, `number`, `checklist`, `status`, `link`, `callout`) with their fields, the pre-formatted-values rule and the https-only link rule. The `icon` enum comes from `BlockIconSchema.literals`, so it can never drift from the protocol.
- **`definitions.ts`**: `buildGroupTools` always appends `POST_BLOCKS_TOOL_DEF` (no flag).
- **`tools.ts`**: barrel exports for the name, the schema and the definition.
- **`gateway/post-blocks.ts`** (new): `createPostBlocksRunner(logger, send)`. Calls `buildBlocksPayload({title,icon,meta,blocks}, text)`; `ok:false` returns `invalid: <reason>` and sends nothing; `ok:true` sends one `groupchat` message to `chat.roomJid` with body `payload.data.fallback` and `{ payload }`; an empty id returns `error: the card could not be posted`; success returns the one-line "card was posted" text. Logs carry only the AI id, the tool and `ok`/the error name.
- **`gateway/tool-exec.ts`**: `POST_BLOCKS_TOOL` added to the group allow-list, the runner built next to `createAskPeopleRunner`, and a dispatch branch that answers `invalid: unknown tool` when `context === undefined` (a DM), like `ask_people`.
- **`gateway/post-blocks.test.ts`** (new): two tests with a fake `send` that records its arguments.

No file needed changes outside the Allowed list. `grep ASK_PEOPLE_TOOL` across `apps/server/src/agents` has hits only in the files above (plus `ask-people.ts` / `ask-people.test.ts`, which this task does not touch).

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/post-blocks.test.ts` → **1 file passed, 2 tests passed**.
- `pnpm gate` (repo root) → **GATE PASS**. Summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first `pnpm gate` run failed on `format` (3 files); I ran `pnpm exec prettier --write` on exactly those 3 files and the re-run passed. No checks were disabled.

### Notes for the lead

- The tool is offered on every group turn because `buildGroupTools` appends it unconditionally; DMs use `buildTools` and are unchanged, so a DM that improvises `post_blocks` gets `invalid: unknown tool`.
- `payload.data.fallback` is reached after a `payload.type !== 'blocks'` guard that is unreachable (the builder only returns blocks); it exists only to satisfy the `Payload` union type.
- The `icon` enum is read from `BlockIconSchema.literals`, so it stays in sync with `packages/protocol`; the schema in `schemas.ts` keeps `icon` a plain capped string and lets `buildBlocksPayload` reject an unknown name with a fixable reason.
- The description now names the block `kind` field with a full example, and lists the six kinds as `kind=figure {…}` and so on (fix round item 2). It is ~660 characters (limit ~1000).
- Deviations: none. No new dependencies.

### Fix round (lead review)

1. **`post-blocks.ts` dead `catch`:** the `try { sent = yield* Effect.promise(send) } catch` could never catch a rejected `send` — inside an Effect generator a rejected `Effect.promise` is a defect that ends the run, so a send failure crashed the tool call. Replaced it with a plain `async function postCard(session, chat, payload)` that awaits `send` inside `try/catch` and returns `{ ok: true; id } | { ok: false; error }`, then `yield* Effect.promise(() => postCard(...))`, like `ask-people.ts:73-106`. The empty-id branch and the log lines are unchanged. Added a third case inside the "refuses an http link" `it`: a `send` that rejects returns `'error: the card could not be posted'`.
2. **`blocks-tool.ts` description:** it now says each block is an object with a `kind` field, shows `{"kind":"figure","rows":[{"label":"BTC","value":"$82,302","change":{"direction":"up","text":"2.1%"}}]}`, and lists the six kinds as `kind=figure {rows:…}` … `kind=callout {tone:…,text}`.

Checks: `cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot` → **1 file passed, 2 tests passed**; `pnpm gate` → **GATE PASS** (see below).

## Review (written by Claude)

- **Accepted at `c31a23ade`.** The lead ran `post-blocks.test.ts`: 2 pass.
- **The first packet was clean, but the lead found two problems:**
  - the `try/catch` around `yield* Effect.promise(send)` couldn't catch a rejected send (an Effect defect never throws into the generator);
  - the description never said that each block carries `kind`.
- **Both are fixed:**
  - a non-rejecting `postCard` helper, like `ask-people.ts`, with a test for a rejected send;
  - the description now opens with a full `{"kind":"figure",…}` example and lists `kind=…` for the six Wave 1 kinds.
- **The tool:**
  - it's offered on every group turn, routine runs included;
  - a DM answers `invalid: unknown tool`;
  - an invalid card returns `invalid: <reason>` so the model can retry;
  - the body is the plain fallback.
- **The nit is accepted:** the unreachable type guard has no log line.
- **Follow-up:** `post_blocks` in DMs is a later task.
