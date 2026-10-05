---
id: T-0256
title: "Audit and plan: forwarding messages, Telegram style (web first), docs only"
status: todo
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

## Review (written by Claude)
