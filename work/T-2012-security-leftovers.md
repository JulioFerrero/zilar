---
id: T-2012
title: "Security leftovers: sticker ffprobe/ffmpeg get the local-only protocol whitelist like voice; findOpenQuestionByMessage requires the room JID so no caller can skip the room check"
status: merged
milestone: M5
branch: task/T-2012-security-leftovers
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2012: Security leftovers

## Spec (written by Claude, do not edit)

### Why
Two pre-reviews on 2026-10-18 left follow-ups that were outside those tasks' files.
- **Stickers (T-2005).** T-2005 limited voice ffprobe/ffmpeg to local files with `-protocol_whitelist`. The sticker converter runs the same tools on uploaded bytes without it, so a crafted playlist could make them fetch internal URLs.
- **Questions (T-1991).** T-1991 made a question card answerable only from its own room, but `roomJid` is still optional in the lookup. A future caller that omits it silently skips the room check.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Sticker converter.** `stickers/convert.ts` (305 lines) has no `protocol_whitelist` in either call:
  - ffprobe runs `['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath]` (`:197-200`);
  - ffmpeg runs `['-nostdin', '-y', ...decodeArgs(codecName), '-i', inputPath, ...]` (`:236-244`).
- **Voice engine.** `voice/engine.ts` already passes `-protocol_whitelist` (`:110`, `:158`) since T-2005. Copy its exact value and position.
- **Question lookup.** `questions/service.ts` (330 lines) declares `findOpenQuestionByMessage(db, messageId, roomJid?: string)` (`:201-205`). When `roomJid === undefined` it runs an unfiltered query (`:210-213`).
- **Callers.** The only production caller, `agents/gateway/question-answer.ts:71`, passes the room. Tests call it without a room in `questions/service.test.ts` (`:66`, `:101`, `:144-145`) and in `agents/gateway/question-answer.test.ts` (`:176-177`, `:186`, `:208`, `:223`, `:264`).

### Steps
1. **Sticker whitelist.** Add the same `-protocol_whitelist` as `voice/engine.ts` to both sticker calls. ffprobe gets it before the input path; ffmpeg gets it before `-i`.
2. **Required room.** Make `roomJid: string` required. Delete the unfiltered branch.
3. **Test callers.** Pass each question's real room JID in every test call. Keep each test's assertions.
4. **New test.** Add one test in `questions/service.test.ts`: a lookup with another room's JID returns `null`.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/questions/service.ts`
- `apps/server/src/questions/service.test.ts`
- `apps/server/src/agents/gateway/question-answer.test.ts`
- `work/T-2012-security-leftovers.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/questions src/agents/gateway/question-answer.test.ts src/stickers --reporter=dot
pnpm gate
```

### Acceptance
The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did
- **Sticker whitelist.** Added `-protocol_whitelist file,pipe` to both sticker tool calls in `apps/server/src/stickers/convert.ts`, copying `voice/engine.ts`: in `probeVideo` after `-show_streams` and before the input path, and in `convertWithFfmpeg` after `-y` and before `-i`.
- **Required room.** `findOpenQuestionByMessage` in `apps/server/src/questions/service.ts` now takes `roomJid: string`; the unfiltered branch is gone and every lookup filters on `room_jid`. Updated the comment above it to say the room is required.
- **Test callers.** `questions/service.test.ts` and `agents/gateway/question-answer.test.ts` now pass each question's real room JID (`asked.room` in the gateway tests). Assertions unchanged.
- **New test.** Added `does not find a question through another room` to `questions/service.test.ts`: the same message id returns `null` for another room's JID and the row for its own room.

Files changed:
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/questions/service.ts`
- `apps/server/src/questions/service.test.ts`
- `apps/server/src/agents/gateway/question-answer.test.ts`
- `work/T-2012-security-leftovers.md`

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/questions src/stickers src/agents/gateway/question-answer.test.ts` — 4 files passed, 23 tests passed.
- `pnpm gate` — GATE PASS:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead
- The whitelist value and position match `voice/engine.ts` exactly (`file,pipe`). I did not add a test for it: the sticker tests mock the tool runner, and AGENTS.md says no tests for UI/glue paths.
- Longest touched file is `questions/service.test.ts` at 332 lines, within the 400-line limit.
- No deviations from the spec, no open questions.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Sticker tools:** the sticker ffprobe and ffmpeg calls get `-protocol_whitelist file,pipe`. For ffmpeg it comes before the decode options and `-i`.
- **Question lookup:** `findOpenQuestionByMessage` now requires the room. Every test passes a real room, and a new test checks that a lookup with another room's JID finds nothing.
