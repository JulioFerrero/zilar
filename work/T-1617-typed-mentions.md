---
id: T-1617
title: "A typed @Name or 'Name, …' wakes the AI: group ingest only counts mentions picked from the list (message.mentions) or replies, so '@Deepseek run …' typed in full is ignored; match the AI's room nick and username in the body on the server, so every client works"
status: merged
milestone: M5
branch: task/T-1617-typed-mentions
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1617: Typed mentions and "Name, …" reach the AI

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16, in Julio's room "ai test › General", a message starting "@Deepseek quick test from the lead: …" got no answer. The `@Deepseek` was typed in full, not picked from the mention list, so it carried no `mentions` entry.
- **The General topic is never followed** (`apps/server/src/agents/gateway/topic-follow.ts:1-9`, T-1529), so nothing else wakes the AI there.
- **Julio (2026-10-16):** "we need to fix the arroba part and the ai needs to be also smart enough to understand that needs to answer and do the job". He chose "Yes, match typed names".
- **Fix it on the server,** so web, phone and older builds all work without a release.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/agents/gateway/group-ingest.ts`** (323 lines):
  - `:145-152`: `const aiBare = normBareJid(session.aiJid); const mentioned = (message.mentions ?? []).some((mention) => normBareJid(mention.jid) === aiBare) || replyTargetsAi({ … aiOccupantJid: \`${roomJid}/${room.nick}\` … });`
  - `:159-165`: without a mention, the message goes to `followTopic`, which never follows General;
  - `body` is already in scope (it is passed to `noteListenerMessage` at `:157`).
- **AI senders are handled separately** (`:167-192`, the handoff hop budget). The new rule must not change that path: only a **person's** typed mention counts, so two AIs can't wake each other by typing names.

### Steps
1. **New file `apps/server/src/agents/gateway/typed-mention.ts`:** export `bodyAddressesAi(body: string, names: readonly string[]): boolean`. It is true when, for any non-empty name and case-insensitively:
   - **(a)** `@<name>` appears at the start of the body or right after whitespace or `( [ { " '`, and is followed by the end of the body, whitespace or punctuation (`,.:;!?)]}'"`). So `a@deepseek.com` does **not** match, and `@Deepseeker` does not match `Deepseek`;
   - **(b)** the body starts (after leading whitespace) with `<name>` followed by `,` or `:`, as in "Deepseek, run the tests".
   - Escape names for any regex. Names may contain spaces (for example `Dev 1`).
2. **In `group-ingest.ts`,** when the sender is **not** an AI (`isAiSender` is false) and `mentioned` is false, also set it when `bodyAddressesAi(body, [room.nick, <the AI's username, the localpart of session.aiJid>])` is true.
   - Keep the change to a few lines. It is then treated exactly like a picked mention: it moves following and queues the turn.
   - Don't use it for edits or retractions; the existing early return at `:90` already covers them.
3. **Tests** in `apps/server/src/agents/gateway/typed-mention.test.ts` (the message pipeline):
   - `@Deepseek run` → true; `@deepseek` → true; `hi @Deepseek.` → true;
   - `mail a@deepseek.com` → false; `@Deepseeker` → false;
   - `Deepseek, run the tests` → true; `Deepseek is slow` → false;
   - `@Dev 1 go` with the name `Dev 1` → true.

### Allowed files
- `apps/server/src/agents/gateway/typed-mention.ts`
- `apps/server/src/agents/gateway/typed-mention.test.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `work/T-1617-typed-mentions.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/typed-mention.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A person's typed `@Deepseek …` or `Deepseek, …` in a group starts a Deepseek turn,** as a picked mention does.
- **AI senders are unaffected.**
- **`group-ingest.ts` stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/agents/gateway/typed-mention.ts` with `bodyAddressesAi(body, names)`: case-insensitive match of `@<name>` bounded on both sides (start/whitespace/`( [ { " '` before, end/whitespace/punctuation after) and of a leading `<name>` followed by `,` or `:`. Names are regex-escaped; blank names are skipped; names may contain spaces.
- In `group-ingest.ts`, added `bodyAddressesAi(body, [room.nick, <localpart of session.aiJid>])` to the `mentioned` check only when `!isAiSender(fromBare)`, so AI senders are unaffected and only a person's typed mention counts. Hoisted `fromBare` so the AI-sender check and the handoff path share it. Edited/retracted messages still return at the existing early return.
- Added `typed-mention.test.ts` covering every case in the spec.

Files changed: `typed-mention.ts`, `typed-mention.test.ts`, `group-ingest.ts`, `work/T-1617-typed-mentions.md`. `group-ingest.ts` is now 328 lines (limit 400).

### Checks run
- `pnpm install`: done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/typed-mention.test.ts`: 1 file passed, 4 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts`: 1 file passed, 18 tests passed (exercises `handleRoomIncoming`).
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (8.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The AI's "username" is the localpart of `session.aiJid` per the spec; there is no separate username field on `AiSession`. Matched names are the room nick and that localpart, both lowercased on the JID side, and the regex is case-insensitive.
- The typed match is treated exactly like a picked mention (moves following via `setTopicFollower`, queues the turn). AI senders keep their existing handoff path unchanged.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 3 nits.
- **What the lead read:**
  - `bodyAddressesAi`: `@name` with a boundary on both sides, or `Name,`/`Name:` at the start, case-insensitive, with the name regex-escaped;
  - the `group-ingest.ts` wiring is a few lines, guarded by `!isAiSender(fromBare)`, using the room nick and the JID localpart.
- **What the lead ran:** `typed-mention.test.ts` passes.
- **After deploy, the lead checks:** in "ai test › General", a typed `@Deepseek …` (not picked from the list) starts a turn. That is the exact case that failed on 10-16 at 01:21.
