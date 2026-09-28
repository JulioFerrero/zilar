---
id: T-0040
title: Server — the owner shapes an AI by talking to it (update_persona / revert_persona tools in the DM turn, one-step undo)
status: todo
milestone: M2
branch: task/T-0040-persona-by-chat
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0034]
estimate: 1.5 days
---

# T-0040: "From now on, answer in Spanish"

## Spec (written by Claude, do not edit)

### Goal

Julio wants AIs to be quick to make and easy to shape. Instead of editing a form, the owner should be able to say, in the AI's DM:
- "from now on, answer in Spanish and keep it short" → the AI **rewrites its own persona** and says so;
- "undo that" → the previous persona comes back.

This is the first time an AI uses a **tool**. Keep it narrow and safe:
- two tools;
- only in the owner's DM (the only turns the gateway runs today);
- only the persona can change, never the model, limits, keys or name.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0034-ai-replies-dm.md`, including the Review: the turn, coalescing, failure texts and redaction rules. **Every one of them still applies.**
- `apps/server/src/agents/reply.ts`, `gateway.ts` and `context.ts`, plus their tests
- `apps/server/src/ais/service.ts` (`updateAi`, `PERSONA` limits, `toPublicAi`) and `apps/server/src/ais/routes.ts` (`CreateAiSchema`: persona max 4000)
- `apps/server/src/db/schema.ts` (the `ais` table) and how earlier tasks added a migration (`pnpm --filter @galena/server db:generate`, which writes `apps/server/drizzle/*.sql` and `meta/`)
- OpenAI-compatible tool calling as LiteLLM passes it through: the request `tools`/`tool_choice`, the response `choices[0].message.tool_calls[{id, function:{name, arguments}}]`, and the follow-up `{role:"tool", tool_call_id, content}`. DeepSeek (`deepseek-chat`) supports it; so do OpenAI and Anthropic through LiteLLM.

### Allowed files
- `apps/server/src/agents/**`
- `apps/server/src/ais/service.ts`: additions only: a gateway-only `setPersonaFromChat(db, aiId, persona)` and `revertPersonaFromChat(db, aiId)`, which also keep the previous persona; plus `previousPersona` in the internal record if needed. Don't change existing behaviour or the public API shape.
- `apps/server/src/db/schema.ts`: one new nullable column, `ais.previous_persona text`.
- `apps/server/drizzle/**`: the generated migration
- `work/T-0040-persona-by-chat.md`

**Not allowed:**
- `apps/web/**`: another task (T-0039) is changing it.
- `apps/mobile/**`
- `packages/**`
- `infra/**`
- `docs/**`
- other server modules

### Allowed dependencies
None.

### What to build

**1. Tools in the turn** (`agents/tools.ts`: pure definitions plus zod schemas)
- `update_persona`, with arguments `{ persona: string (1..4000, trimmed), summary: string (1..200) }`.
  - Its description tells the model: use it only when the owner asks to change how you behave from now on; `persona` is the complete new persona, not a diff; `summary` is one short line.
- `revert_persona`, with no arguments. Its description: use it when the owner asks to undo the last persona change.
- The DM turn sends `tools` with `tool_choice: "auto"`.
- The system message gains one line: "You can change your own persona with update_persona when your owner asks you to change how you behave from now on."

**2. The tool loop** (`agents/reply.ts`)
- If the response has `tool_calls`:
  1. Validate each call's `arguments` (a JSON string) with zod.
  2. Execute it.
  3. Append the assistant message with its tool_calls, plus one `{role:"tool", tool_call_id, content}` per call, carrying a short result: `"ok"`, `"nothing to undo"`, or `"invalid: <reason>"`.
  4. Call the model **once more**, to get the text reply.
- **At most 2 model calls per turn:**
  - if the second response asks for tools again, ignore those calls and use its text;
  - if it has no text, reply with the fallback text.
- Unknown tool names and invalid arguments are **not executed**. They return `invalid: …` to the model and are logged with the AI id (arguments redacted, never the persona text).
- Every existing rule still holds:
  - one turn at a time per AI, with coalescing;
  - the failure texts table;
  - `redactSecrets` everywhere;
  - `max_tokens` on both calls;
  - the same timeout per call.

**3. Persona storage** (`ais/service.ts` additions, plus a migration)
- `setPersonaFromChat(db, aiId, persona)`:
  - in **one transaction**, set `previous_persona = persona` (the current value), then `persona = <new>`, and `updated_at`;
  - trim and cap at 4000, the same as the API;
  - use the AI id from the gateway's session, never from the model's arguments.
- `revertPersonaFromChat(db, aiId)`:
  - if `previous_persona` is null, return `"nothing to undo"`;
  - otherwise swap them, so a second undo re-applies the change (a toggle, one level deep). Document that in a comment.
- The next turn must use the new persona. The context builder reads the persona per turn, so check that no cached copy stays stale.

**4. What the owner sees**
- After a successful `update_persona`, append a fixed line to the AI's text reply: `\n\n✏️ Persona updated: <summary>. Say "undo" to revert.`
- After a successful `revert_persona`, append `\n\n↩️ Persona restored.`
- These lines are added by the gateway, not the model, so they're reliable and testable.
- Truncate `summary` to 200 characters, and strip newlines and control characters.

**5. Safety**
- Tools exist only in turns the gateway already runs, which means only the owner's DMs (T-0034 gating). Add a test proving that a message from a non-owner never reaches the tool path. It shouldn't reach the model at all.
- The tool can't touch anything but `ais.persona` and `ais.previous_persona` for the session's own AI id.
- The persona is **never logged**, in whole or in part. Log only `{ aiId, tool, ok }`.

### Tests (Vitest, fake fetch and fake XMPP, no network)
- **`tools.ts`:**
  - valid arguments parse;
  - these are rejected: an empty persona, more than 4000 characters, a missing summary, non-JSON arguments, extra keys.
- **Turn with `update_persona`:**
  - exactly 2 LiteLLM calls;
  - the second request contains the assistant `tool_calls` message and the `tool` message with `"ok"`;
  - the DB persona is updated and `previous_persona` holds the old value;
  - the DM text ends with the exact "Persona updated" line.
- **`revert_persona`:**
  - it restores the old persona;
  - with nothing to undo, it sends `"nothing to undo"` to the model and adds no "restored" line;
  - calling it twice toggles.
- **The next turn** uses the new persona in its system message.
- **Unknown tool and invalid arguments:** nothing is executed, `invalid: …` goes back to the model, and no persona text appears in logs.
- **A second response that asks for tools again:** those calls are ignored, and there are still only 2 calls.
- **Failures on the second call** (429, 401, 5xx, timeout) give the same failure texts as T-0034. The persona change from the first call **stays**, and the reply says so: append the "Persona updated" line to the failure text.
- **Redaction:** there is no key and no persona text in any log line, `err.message` or `err.stack`.
- **Migration:** the existing migrate test still passes, and the new column is nullable.

### Integration check (gated `GALENA_AGENT_INTEGRATION=1`; run it yourself)
Use T-0034's integration test setup (made-up key, own branch server port, cleanup). The fake key can't produce a real tool call, so assert only that:
- the request LiteLLM receives includes `tools`, which you can observe through your test double or by logging the request **shape** (tool names only);
- the reply is still the exact "provider rejected the API key" text.

Report the real result. The lead verifies a real tool call with Julio's DeepSeek key.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The owner can change the persona by chat and undo it. It's tested end to end at the gateway level with fakes.
- [ ] At most 2 model calls per turn. Tools never run outside the owner's DM, and only the persona can change.
- [ ] The persona text and keys never appear in logs or errors.
- [ ] The migration is generated by drizzle-kit, not hand-written, and applies on startup.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Web UI for undo or history (the side panel from T-0039 shows the current persona).
- More tools (web search, desks).
- Groups.
- Streaming.

## Report (written by the worker when done)

## Review (written by Claude)
