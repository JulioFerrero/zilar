---
id: T-1710
title: "AIs answer like a chat: one or two short sentences, no step narration, no caveats or alternatives unless something can't be done, and no tool names, hostnames or URLs in messages (the approval card shows hosts) — Julio 2026-10-16: 'very verbose, this is a chat, less text the better'"
status: merged
milestone: M5
branch: task/T-1710-short-chat-replies
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1710: Shorter AI replies

## Spec (written by Claude, do not edit)

### Why
Julio's test on 2026-10-16. @Deepseek answered a prices request with:
- a paragraph listing the hosts it needed;
- a "heads-up on the interval" (288 messages a day, "say the word if you'd rather have every 30 min…").

Julio: "very verbose, this is a chat, less text the better", and he doesn't want tool names or full service URLs shown.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/agents/context.ts`** (294 lines):
  - `:65-66` (DM): ``…talking in a private chat with ${input.ownerName}. Reply in plain text; keep it concise unless asked.``;
  - `:126-128` (group): ``…${sender} mentioned you: reply to them directly. Reply in plain text; keep it brief unless asked for more.``
- **`apps/server/src/agents/tool-guide.ts`:**
  - `TOOL_GUIDE_LINES` (`:8-19`) is the tool guide added when tools are on (`TOOL_GUIDE_MAX_CHARS = 6000`, `:6`);
  - `:14`: `'A tool contacts a host only after the human approved it with \`tool.approve_hosts\`. Say plainly which hosts you need and why before asking, and wait for the approval.'`;
  - `:18`: `'Keep messages short and report what was done ("Saved gold-price v1, tested OK").'`
- **No test pins these strings** (the lead grepped `keep it brief`, `keep it concise` and `TOOL_GUIDE` in `*.test.ts`).

### Steps
1. **`context.ts:66` and `:128`:** replace the trailing style sentence in both with exactly:

   `This is a chat: reply in plain text, in one or two short sentences unless asked for more. Do what was asked without caveats or alternatives unless it cannot be done.`
2. **`tool-guide.ts:14`:** replace it with:

   `'A tool contacts a host only after the human approved it with \`tool.approve_hosts\`. Ask and wait; do not list the hosts in your message, the approval card shows them.'`
3. **`tool-guide.ts:18`:** replace it with:

   `'Keep messages short: never narrate your steps (the app shows them), and never write tool names, hostnames or URLs unless the person asks for them.'`
4. **No other change.** Check that `TOOL_GUIDE` stays under `TOOL_GUIDE_MAX_CHARS`.

### Allowed files
- `apps/server/src/agents/context.ts`
- `apps/server/src/agents/tool-guide.ts`
- `work/T-1710-short-chat-replies.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The new texts are in place:** both system prompt lines and both guide lines carry the new wording.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
Applied the four wording changes from the spec, and nothing else:
- `apps/server/src/agents/context.ts:66` (DM platform line): replaced the trailing
  style sentence with the new one — `` …with <ownerName>. This is a chat: reply in
  plain text, in one or two short sentences unless asked for more. Do what was asked
  without caveats or alternatives unless it cannot be done. ``
- `apps/server/src/agents/context.ts:128` (group platform line): same replacement after
  `` …<sender> mentioned you: reply to them directly. ``
- `apps/server/src/agents/tool-guide.ts:14`: now `` 'A tool contacts a host only after
  the human approved it with `tool.approve_hosts`. Ask and wait; do not list the hosts
  in your message, the approval card shows them.' ``
- `apps/server/src/agents/tool-guide.ts:18`: now `` 'Keep messages short: never narrate
  your steps (the app shows them), and never write tool names, hostnames or URLs unless
  the person asks for them.' ``

`TOOL_GUIDE` length after the change is 1662 chars, well under `TOOL_GUIDE_MAX_CHARS`
(6000). Checked with a local `node -e` read of `TOOL_GUIDE_LINES`; no test pins these
strings (grep for `TOOL_GUIDE`/`TOOL_GUIDE_MAX_CHARS` in `*.test.ts` found nothing), as
the spec stated.

Files changed: `apps/server/src/agents/context.ts`, `apps/server/src/agents/tool-guide.ts`,
`work/T-1710-short-chat-replies.md`.

### Checks run
- `pnpm install` — Done in 12.8s (only a pre-existing peer-dependency warning in
  `apps/mobile`: `@types/react-dom 19.3.0` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm gate` — GATE PASS. Real summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (14.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No individual test file was run separately; the only test-bearing package touched,
  `@zilar/server`, is covered by the gate's `tests @zilar/server` step.

### Notes for the lead
- No deviations from the spec. No tests added: the change is prompt text only, and the
  spec's tests rule says a test is only warranted for crucial code; the spec also noted
  no test pins these strings.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff:** exactly the four strings from the spec:
  - the DM and group system prompts now ask for one or two short sentences with no caveats;
  - the tool guide no longer asks the AI to list hosts, and it bans step narration, tool names, hostnames and URLs.
- **Context:** this answers Julio's "very verbose, this is a chat" from 2026-10-16.
