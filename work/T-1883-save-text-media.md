---
id: T-1883
title: "Media cards M5: the `save_text_media` model tool (name, format csv|txt|md|json, content ≤ 64 KiB UTF-8) stores AI-written text as card media through storeCardMedia and returns the id for a `file` block; offered and dispatched exactly like fetch_media, sharing its 4-per-turn budget"
status: merged
milestone: M5
branch: task/T-1883-save-text-media
model: auto
effort: default
depends_on: [T-1873, T-1879]
estimate: 40 min
---

# T-1883: `save_text_media`, an AI-written file for a card (media plan M5)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/message-blocks-media.md` §6 M5** (Julio took every recommendation on 2026-10-17). With `fetch_media`, the AI can show a file from the web. With this tool it can hand over a file it wrote itself, e.g. "export that table as CSV", in a `file` card that people download.

### Facts (read by the lead on 2026-10-17)
- **`fetch_media` (T-1873) is the pattern to copy, file by file:**
  1. `apps/server/src/agents/tools/schemas.ts:24` (the name) and `:287` (the `ParsedToolArguments` member);
  2. `apps/server/src/agents/tools/parse.ts:111` (the known-name list) and `:220-232` (the branch);
  3. `apps/server/src/agents/tool-loop.ts:85` (the `ValidToolCall` member);
  4. `apps/server/src/agents/tool-calls.ts:235-243`;
  5. `apps/server/src/agents/tools.ts:15`, `:58`;
  6. `apps/server/src/agents/tools/media-tool.ts` (the definition);
  7. `apps/server/src/agents/tools/definitions.ts:322`, `:354` (offered next to `post_blocks`);
  8. `apps/server/src/agents/gateway/tool-exec.ts`: the known-tool guard (`:155`), the dispatch with the DM key `session.aiJid` (`:244-268`), and the `fetchedMedia` per-turn counter;
  9. `apps/server/src/agents/gateway/fetch-media.ts` (the runner: the `cardMediaDir` check, fixed `error:` lines, the `fetched:` result line, `logOutcome` with a fixed reason).
- **`storeCardMedia(db, dir, { aiId, roomJid, groupId?, topicId?, mime, name, width?, height?, bytes })`** (`apps/server/src/card-media/service.ts:51`) enforces the quota and throws `CardMediaQuotaError` when it's reached.
- **File sizes:** `tool-exec.ts` is 321 lines, `parse.ts` 362, `schemas.ts` 289. Every file must stay at most 400.

### Steps
1. **`schemas.ts`:**
   - `SAVE_TEXT_MEDIA_TOOL = 'save_text_media'`;
   - `SaveTextMediaArgsSchema`: `name` (trimmed, 1..100), `format` (literals `csv` | `txt` | `md` | `json`) and `content` (string, 1..65536 chars);
   - the `ParsedToolArguments` member.
2. **`parse.ts`, `tool-loop.ts`, `tool-calls.ts`, `tools.ts`:** mirror `fetch_media`.
3. **The definition:** in `media-tool.ts`, add `SAVE_TEXT_MEDIA_TOOL_DEF` with the description:

   > Save text you wrote (CSV, plain text, Markdown or JSON; at most 64 KB) as a file people can download from a card. Returns a media id: put it in a `file` block's `media`.

   **`definitions.ts`:** offer it right after `FETCH_MEDIA_TOOL_DEF` in both places.
4. **New `apps/server/src/agents/gateway/save-text-media.ts`:**
   - map the format to a mime: csv → `text/csv`, txt → `text/plain`, md → `text/markdown`, json → `application/json`;
   - for `json`, refuse content that `JSON.parse` rejects with `error: the content is not valid JSON`;
   - encode with `TextEncoder`, and refuse more than 65,536 bytes with `error: the file is too large`;
   - the stored name is the trimmed name plus `.<format>` when it lacks that extension, sanitised like `fetch.ts` does (`[A-Za-z0-9._ -]`);
   - store with `storeCardMedia`. `CardMediaQuotaError` → `error: media quota reached`; any other error → `error: the file could not be stored`;
   - success returns `saved: media id <id>, name <name>, size <human size>, format <CSV|TXT|MD|JSON>. Put the id in a file block.`;
   - logging matches `fetch-media.ts`: ids, outcome and the fixed reason.
5. **`tool-exec.ts`:** add the tool to the known-tool guard and dispatch it exactly like `fetch_media` (the group room, or `session.aiJid` in the owner's DM; otherwise an unknown tool). It shares the same per-turn counter, so at most 4 media per turn across both tools; rename the counter to `mediaThisTurn`.
6. **No new test.** The quota and store are covered by T-1847's test. If an existing test lists the offered tools, update it.

### Allowed files
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/tools/parse.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tool-calls.ts`
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tools/media-tool.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/gateway/save-text-media.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `work/T-1883-save-text-media.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`save_text_media` is offered wherever `fetch_media` is.** It stores valid text as card media and returns the id line.
- **Bad JSON, oversize content and the quota** give fixed `error:` lines.
- **Together with `fetch_media`,** at most 4 media per turn.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`schemas.ts`:** added `SAVE_TEXT_MEDIA_TOOL = 'save_text_media'`, `SAVE_TEXT_MEDIA_FORMATS` and its `SaveTextMediaFormat` type, the caps (name 100, content 65,536 chars), `SaveTextMediaArgsSchema` (`name` trimmed 1..100, `format` csv|txt|md|json, `content` string 1..65,536) and the `ParsedToolArguments` member.
- **`parse.ts`:** the name is on the known-name list and the new branch decodes the arguments into the parsed call.
- **`tool-loop.ts`:** `ValidToolCall` member for `save_text_media`.
- **`tool-calls.ts`:** maps the parsed call to the valid call.
- **`tools.ts`:** exports the new name, schema, format type and tool definition.
- **`media-tool.ts`:** added `SAVE_TEXT_MEDIA_TOOL_DEF` with the description from the spec (name, format enum, content maxLength 65,536).
- **`definitions.ts`:** `SAVE_TEXT_MEDIA_TOOL_DEF` is offered right after `FETCH_MEDIA_TOOL_DEF` in both `buildTools` (owner's DM) and `buildGroupTools`.
- **New `gateway/save-text-media.ts`:** Effect-based runner like `fetch-media.ts`. Maps csv→`text/csv`, txt→`text/plain`, md→`text/markdown`, json→`application/json`; `json` content that `JSON.parse` rejects answers `error: the content is not valid JSON`; content over 65,536 UTF-8 bytes (`TextEncoder`) answers `error: the file is too large`; the stored name is the trimmed name plus its `.<format>` extension when missing, sanitised with `[^A-Za-z0-9._ -]`; `storeCardMedia` is called with the AI id and chat media key from the session/turn and `CardMediaQuotaError` → `error: media quota reached`, any other store error → `error: the file could not be stored`; success answers `saved: media id <id>, name <name>, size <human size>, format <CSV|TXT|MD|JSON>. Put the id in a file block.`; logs carry `aiId`, tool, outcome and fixed reason only. A missing `cardMediaDir` answers `error: media is not available`, like `fetch_media`.
- **`tool-exec.ts`:** the known-tool guard accepts `save_text_media`; the `fetch_media` and `save_text_media` dispatch share one branch: group room or `session.aiJid` in the owner's DM, otherwise `invalid: unknown tool`. The counter is renamed `mediaThisTurn` and caps both tools together at 4 per turn.
- No test added, per the spec. No existing test lists the offered tools (checked `desk-definitions.test.ts`, `parse.test.ts`, `group-turn-card.test.ts`), so `group-turn-card.test.ts` is unchanged.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/parse.test.ts src/agents/tools/desk-definitions.test.ts src/agents/group-turn-card.test.ts` — 3 files, 7 tests passed.
- `pnpm gate` (repo root) — final run after the Report and front-matter edits:
  - `gate: 10 changed file(s) against main`
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (1.3s)`
  - `PASS  lint  (0.7s)`
  - `PASS  typecheck  (0.9s)`
  - `PASS  effect  (0.6s)`
  - `PASS  tests @zilar/server  (19.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

Earlier gate runs failed first on Prettier formatting (fixed with `pnpm exec prettier --write` on the two files) and then on the Effect ratchet (the first runner draft used `async`/`try`/`catch`; rewritten with `Effect.gen`/`Effect.try`/`Effect.match`).

### Notes for the lead

- The runner is not covered by a new test, as the spec asked. Its behaviour was verified by typecheck and by reading against `fetch-media.ts`; I did not exercise it against a database.
- `text/markdown` and `application/json` are new mimes for card media (only `fetch_media`'s sniffed set existed before). The spec names them and `storeCardMedia` does not restrict mimes; the serve route (`card-media/api.ts`) sets `content-type` from the row and sends every non-image as `attachment`, so both download normally. I did not change that file.
- `SaveTextMediaArgsSchema.content` caps at 65,536 characters; the runner additionally caps at 65,536 UTF-8 bytes, so multi-byte text between those two limits gets the fixed `error: the file is too large` instead of being stored.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `09ef6139e`.
- **`save_text_media`** follows `fetch_media`'s path file by file, and both share the 4-per-turn `mediaThisTurn` counter.
- **Fixed `error:` lines** cover bad JSON, more than 64 KiB of UTF-8, the quota and store failures.
- **The stored name** is sanitised and gets the format's extension; the bytes live under a server UUID.
- **File sizes:** `tool-exec.ts` 330, `parse.ts` 378, `schemas.ts` 323.
- **Live check** after the next deploy: in "cards test", ask Deepseek for a CSV file card.

