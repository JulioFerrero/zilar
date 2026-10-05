---
id: T-0256
title: "Audit and plan: forwarding messages, Telegram style (web first), docs only"
status: merged
milestone: M5
branch: task/T-0256-forwarding-plan
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0256: forwarding plan

## Spec (written by Claude, do not edit)

### Why
D28 in `docs/PROJECT_PLAN.md` (line 141) lists forwarding as a must-have for a human-first daily chat, and nothing forwards messages today (`grep -rli forward apps/web/src packages/chat-core/src packages/protocol/src` finds only an unrelated comment in `apps/web/src/store/realStore.ts` line 1403). Before any code, the lead needs a plan built from the real code. This task writes a document only: NO code, config or package changes.

### Verified facts (do not re-derive)
- Payloads: `packages/protocol/src/payload.ts` lines 14-37 hold `PayloadSchema`, a discriminated union on `type` with `v: 0`. It includes `attachment`, `sticker`, `voice` and `poll`. `MAX_PAYLOAD_BYTES = 64 * 1024` is at line 12.
- The web store is `apps/web/src/store/realStore.ts`, with the store types in `apps/web/src/store/store.ts`. Mobile has `apps/mobile/src/store/real-store.ts` and `apps/mobile/src/store/chat-store.ts`.
- The server has modules per area under `apps/server/src/` (for example `pins`, `stickers`, `voice`, `avatars`, `blocks`). XMPP is ejabberd with MAM history.
- The product direction is Telegram-like (`docs/PROJECT_PLAN.md` D25-D28).

### What to write: `docs/audit/forwarding-plan.md`
1. **Today:** how a message is sent and stored on web, with `file:line` for each step:
   - text, replies and mentions;
   - attachments (where the file lives and who may read it), stickers, voice notes and GIFs.
   For each kind, say whether re-sending the same content to another chat works as is or needs the server (for example, an attachment URL that only members of the source chat may read).
2. **Telegram behaviour to copy:**
   - the "Forwarded from <name>" header;
   - forwarding one or several messages;
   - picking one or more target chats in a search sheet;
   - an optional comment;
   - forwarding from channels;
   - the sender's privacy option to hide the original name. Say which of these we take now and which later.
3. **Design:**
   - the wire format, for example a `forward` field or payload carrying the origin (sender id and name, origin chat if public, original time), validated in `packages/protocol`;
   - how each content kind is copied (re-upload or a server copy endpoint for attachments, and its access check);
   - what the receiver shows;
   - what AIs see;
   - blocked people;
   - topics.
4. **Task split:** ordered small tasks (protocol and chat-core, server copy endpoint if needed, web UI with the message menu entry plus multi-select plus target picker, then mobile). For each: Allowed files with full paths, tests, and the risks.
5. **Open questions for Julio**, each with a recommended answer.

### Read first
`AGENTS.md`, `packages/protocol/src/payload.ts`, `packages/protocol/src/attachment.ts`, `apps/web/src/store/realStore.ts` (the send paths), `docs/PROJECT_PLAN.md` (D25-D28).

### Allowed files
`docs/audit/forwarding-plan.md` (new), `work/T-0256-forwarding-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every claim about today's code has a `file:line`. The task list is small enough to spec straight from it.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
Wrote `docs/audit/forwarding-plan.md`, a document-only audit and plan for
forwarding. No code, config or package change. The plan covers, per the spec:
today's web send/store paths with `file:line`; Telegram behaviour with a
now/later table; the design (wire format, per-kind copying, receiver display, AI
view, blocks, topics); an ordered task split with Allowed files, tests and risks;
and seven open questions with recommended answers.

Key finding that changes the spec's premise: attachments have **no per-chat read
ACL**. `/upload/*` is reverse-proxied straight to ejabberd with no auth
(`deploy/caddy/Caddyfile:39-43`, `deploy/baremetal/nginx-zilar.conf:97-101`,
`deploy/ejabberd/ejabberd.yml:233-251`) and the client trusts media by host, not
membership (`apps/web/src/lib/attachments.ts:99-134`). So re-sending an
attachment/voice/sticker URL to another chat works as-is; the real risk is the
per-user upload quota deleting the uploader's oldest files (durability, not
access). The plan recommends no server copy endpoint now and records it as a
later, optional task.

### Files changed
- `docs/audit/forwarding-plan.md` (new)
- `work/T-0256-forwarding-plan.md` (report + status)

### Commands and real results
- `pnpm install`: done in 12.4s, exit 0. Did not touch `pnpm-lock.yaml`
  (`git status` shows only the two files above).
- `pnpm gate` (repo root), summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (29.6s)
PASS  lint  (1.7s)
PASS  typecheck  (1.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

No package source changed, so the gate ran no package tests. I ran no other test
suites (the task is docs only).

### Deviations from the spec
- The spec's example of an attachment "URL that only members of the source chat
  may read" does not hold in this codebase; I documented the verified access
  model instead (§1.3, §3.2) rather than assuming it.
- Nothing else deviated. `docs/PROJECT_PLAN.md`, `AGENTS.md` and `work/BOARD.md`
  were read only, never edited.

### Problems
None. Gate is green and scope is clean.

### Open questions for Julio
Seven, each with a recommended answer, at the end of
`docs/audit/forwarding-plan.md` (§5): comment handling, re-upload vs reuse URL,
hide-original-name privacy, forwarding from private topics, forwarding into a
channel as a non-admin, keeping reply/mentions, and the multi-select entry point.
No code is blocked on them; they shape the follow-up tasks.

### Round 2 — prereview fixes

`PREREVIEW.md` findings: must-fix 0, should-fix 1, nits 3.

- **Finding 1 (should-fix, `docs/audit/forwarding-plan.md:158`)** — fixed.
  `chat_id` now carries the same "only for a public origin" qualifier as
  `chat_name`, and §3.1 states the producer rule that both fields are set
  together only for a public origin; a private-topic (or DM) origin omits both,
  so target members never learn the private room JID. §3.6 repeats the rule
  where forwarding from a private topic is discussed.
- Nits 2-4 left untouched: the instruction is to leave nits alone unless they sit
  on a line this round already changes.

Tests: none added or adjusted. Docs-only task; finding 1 names no test and no
source or test file changed, so there is no behaviour to cover.

Commands: none beyond `pnpm gate` (docs only; no single test files were touched).

`pnpm gate` from the repo root, after the edits:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (16.3s)
PASS  lint  (0.6s)
PASS  typecheck  (0.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Verdict:** Approved; clean after 1 auto round (4 nits).
- The design is sound: a separate `<forward>` element keeps the payload untouched, and private-topic origins carry no room JID.
- T-A and T-B (protocol and xmpp-core) do not depend on Julio's open questions, so they go first. The UI tasks wait for his answers to §5.
