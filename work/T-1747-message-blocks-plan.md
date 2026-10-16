---
id: T-1747
title: "Plan: message blocks, native UI blocks that AIs and saved tools put in messages (25 kinds, web + phone), from the approved boards in docs/design/mockups/blocks/"
status: merged
milestone: M5
branch: task/T-1747-message-blocks-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1747: Message blocks plan

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio approved a canvas of 25 native "message blocks" that an AI, or a saved tool, can put inside a message: figures, charts, a checklist, buttons, a poll, a place, the weather and so on. His words: "if this can be used by the ais inside zilar and looks this good will be increible". The boards and the shared look are in `docs/design/mockups/blocks/` (read the `README.md` and every `.dc.html` there). This task writes the plan only. No code.

### Facts (the lead read them on 2026-10-16)
- **The payload union:** messages already carry typed payloads. It's `PayloadSchema` in `packages/protocol/src/payload.ts:18-58`, with kinds such as `progress`, `approval.request`, `poll`, `poll.vote`, `question` and `routine`.
  - Each kind's data schema has its own file (`packages/protocol/src/poll.ts`, `question.ts`, `routine.ts`), with length caps through `Schema.check`.
- **On the wire:** the payload is JSON text in `<agent xmlns='urn:zilar:agent:0'>` (`packages/xmpp-core/src/namespaces.ts:1`), decoded in `packages/xmpp-core/src/stanza/decode.ts:84-91` with `decodePayload` from `@zilar/protocol`.
- **On the server:** `apps/server/src/notify/ai-cards.ts:1-16` is the one "live AI UI" rule shared by push, unread and preview, the memory indexer and the media extractor.
- **Rendering:**
  - phone: `apps/mobile/src/components/chat/payload-card.tsx:41-50`, a switch over `card.type`, plus `RENDERED_CARD_TYPES`;
  - web: `apps/web/src/components/message/AttachmentBody.tsx:249-271` (`message.card.type`).
- **Interactive precedent:** `question` (T-1576: 2-4 option chips that answer the AI, with `ai_questions` rows) and `poll` and `poll.vote`.
- **Saved tools** return `{ text, data? }` (`docs/TOOL_SANDBOX.md:13-14`; `parseToolOutput` in `apps/server/src/sandbox/types.ts:52`).
  - A tool routine posts `"<title>\n<output.text>"` (`apps/server/src/routines/execute.ts:16-18`).
  - Routine messages are edited in place by later runs (`docs/plan/routine-live-message.md`).
- **AI replies** in group chats render as Markdown (`packages/chat-core/src/markdown.ts:10-21`).
  - A new model tool needs `apps/server/src/agents/tools/parse.ts`, `tool-calls.ts`, `group-turn.ts` and the definitions (lead memory: T-1576 was blocked by a missed file). A `request_action` adapter is the other path (`apps/server/src/tools/*-adapters.ts`).
- **Rules:** files of at most 400 lines; tests only for auth and keys, permissions and money, and the message pipeline; every user-facing change ships on web and phone.

### Steps
Write `docs/plan/message-blocks.md` with these sections. Cite `file:line` for every claim about current code, and read the code before you write about it.
1. **The schema.**
   - A new payload kind `blocks` (v0): an ordered list of typed blocks, one entry per board block (01–25), each with exact fields and caps (string lengths, rows, points, options).
   - Optional `title`, `icon` (a fixed icon set, named) and `meta` for the header row.
   - A required plain `fallback` text, for push, previews, search, memory and old clients.
   - A total size cap.
   - Write the TypeScript and Effect Schema shape for at least 6 kinds in full; list the rest as a table.
2. **Where blocks come from,** with the path each takes:
   - **(a) An AI turn:** recommend one: a new model tool, a `request_action` adapter, or a fenced block in the reply. Weigh the token cost and how well models follow each.
   - **(b) Saved-tool output:** `{ text, blocks? }`.
   - **(c) Tool routines:** the routine post carries the blocks, and later runs edit them.
3. **Interactive blocks** (08 checklist, 13 buttons, 14 poll, 15 pick one, 16 quick form, 17 rating, 18 alert rule):
   - how a tap travels (reuse the `question` and `poll.vote` paths where you can) and who may act;
   - where the shared state lives (for example the checklist ticks everyone sees);
   - how the AI learns the answer (does it wake a turn?);
   - idempotency, and what an old client shows.
4. **Rendering:** one shared block model in `packages/chat-core`, and the component split for web (`apps/web/src/components/message/blocks/…`) and phone (`apps/mobile/src/components/chat/blocks/…`), each file at most 400 lines; an unknown kind shows the fallback text; accessibility.
5. **Safety:**
   - the server validates before relaying;
   - only https links, and images only from uploaded media;
   - no HTML;
   - block text is untrusted data, never instructions, when it's fed back to a model.
6. **The task breakdown:** ordered tasks with exact files, a minutes estimate and the web and phone twins, small enough for one worker each (about 20–45 min).
   - The first wave: the schema, the server validation, a basic renderer and 6 blocks (01 figures, 02 big number, 08 checklist read-only, 12 status list, 19 link card, 25 callout) on web and phone, plus the AI and tool paths.
   - Later waves: the rest.
   - At most 2 tests per task, and only in the message pipeline.
7. **Open questions for Julio** (at most 4), each with a recommended answer.

### Allowed files
- `docs/plan/message-blocks.md`
- `work/T-1747-message-blocks-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`docs/plan/message-blocks.md`** covers sections 1–7 with `file:line` citations and a task list a lead can turn into specs.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
Wrote `docs/plan/message-blocks.md` (plan only, no code), covering the seven
sections the spec asks for:
1. One new payload kind `blocks` (v0) in `packages/protocol/src/blocks.ts`, an
   ordered list of 25 typed blocks (01–25), an optional `title`/`icon`/`meta`
   header row, a required plain `fallback`, a 16 KiB block cap under the 64 KiB
   payload cap, and a fixed lucide-backed icon set. Six first-wave kinds are
   written out in full TypeScript + Effect Schema; the other 19 are a table.
2. The three sources and their paths: an AI turn (recommends a new `post_blocks`
   model tool; rejects `request_action` and a fenced reply, with reasons), saved
   tool output (`{ text, blocks? }`), and tool routines (the post and its
   corrections carry the blocks).
3. The interactive seven (08, 13, 14, 15, 16, 17, 18): reuse the `question`
   tap→mention→turn path, a new `block_responses` table for shared state keyed
   by `(message_id, block_id, item_id, actor_id)`, which taps wake a turn
   (decision kinds yes, checklist/poll no), idempotency, and the old-client
   fallback.
4. Rendering: a shared `normalizeBlocks` model in `packages/chat-core`, a
   one-file-per-kind component split for web and phone (each ≤ 400 lines), the
   unknown-kind fallback, and accessibility.
5. Safety: server-side validation before relay, https-only links, images and
   files only by uploaded media id, no HTML, and block text as
   `<untrusted-tool-output>` data when fed back to a model.
6. A task breakdown in three waves: wave 1 is the schema, server validation, the
   shared model, six blocks on web and phone, and the AI and tool paths
   (B1–B7); later waves are the interactive core (B8–B11) and the rest
   (B12–B17). At most two tests per task, only in the message pipeline.
7. Four open questions for Julio, each with a recommended answer.

Every claim about current code carries a `file:line` citation; I read the code
before citing it. I also read the boards (`README.md` and the ten `.dc.html`
files) to get the 25 kinds and their exact fields.

### Checks run
- `pnpm install` — done, clean (no lockfile change; `git status` shows only my
  two Allowed files).
- `pnpm gate` from the repo root — **GATE PASS**. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change is documentation only, so no package
  test is "near" it (the gate skipped `effect` and ran no tests).

### Notes for the lead
- Files changed: `docs/plan/message-blocks.md` (new),
  `work/T-1747-message-blocks-plan.md` (status).
- No deviations from the Spec: sections 1–7 are all present, no code was
  written, and only the two Allowed files were touched.
- Two design choices worth your eye, both flagged in the doc and both in the
  open questions: (a) a new `post_blocks` model tool over the `request_action`
  adapter for the AI path; (b) a new `block_responses` table for the shared
  interactive state, with checklist/poll taps deliberately not waking a turn.
- I could not confirm at runtime that `poll` / `poll.vote` have no server
  handler; I checked by grep and found only the protocol definitions
  (`packages/protocol/src/poll.ts`) and no server consumer, so the doc says so
  and gives the first block task ownership of any needed handler.

### Blocked / needs a decision
None.

### Round (fix round, 2026-10-16)

`PREREVIEW.md` at the worktree root had must-fix=0, should-fix=1, nit=3.

- **Finding 1 (should-fix) — fixed.** `docs/plan/message-blocks.md` §2(a) and
  B6 now name the gateway offer/plumbing files for a new model tool, not just
  the four tool files. Added: the offer gate
  (`apps/server/src/agents/gateway/group-turn-access.ts:61-64`), the turn
  context (`gateway/group-turn.ts:47-65`), the `buildGroupTools` call
  (`gateway/group-turn-body.ts:200-228`), the guard and dispatch
  (`gateway/tool-exec.ts:148-153,196-207`) and the runner path. I read every
  cited range before writing it. §2(a) now also cites the spec line that names
  `group-turn.ts` (`work/T-1747-message-blocks-plan.md:33`).
- **Nits 2–4 — not changed.** Per the operator rule to leave nits alone unless
  they fall in a line the fix already touches. Nit 2 (`HttpsUrlSchema` in two
  places) and nit 3 (the `ask-people.ts` citation off by a couple of lines) sit
  in lines finding 1 did not need. Nit 4's B6 sentence ("Test one in the message
  pipeline") did fall inside the rewritten B6 line, but naming a server-side
  test home is a decision for the lead and the reviewer marked the nits
  optional, so I left the wording rather than guess.
- **No code, tests or migrations changed.** The Spec says "No code"; this is a
  plan-only task, so there is no behaviour to test and no new test file. No
  single test was run for that reason.

## Review (written by Claude)

- **Accepted at `a1a37f438`.** It's clean after one automatic round (3 nits), and the packet is current. The diff is the plan doc and this file only.
- **The lead read the whole plan:**
  - the `blocks` payload kind with a required `fallback`;
  - a `post_blocks` model tool (the fix round added the gateway files to its path);
  - a `blocks` field on saved-tool output, which routines carry;
  - taps through the `question` path with a `block_responses` table, where checklist and poll taps don't wake a turn;
  - three waves.
- **Adjustments the lead makes in the specs:**
  - the protocol schema is split by group (`blocks-*.ts`) to stay under 400 lines;
  - `place` drops `directionsUrl` for an https `url`, and its map is an optional uploaded media id (no map service).
- **The §7 recommendations stand,** as the lead's defaults; Julio can overrule them.

Gate re-run (`pnpm gate` from the repo root):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

