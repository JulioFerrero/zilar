---
id: T-0261
title: "Forwarding step 1: ForwardOriginSchema in protocol, and xmpp-core builds and parses a <forward xmlns='urn:zilar:forward:0'> element"
status: todo
milestone: M5
branch: task/T-0261-forward-wire
model: auto
effort: low
depends_on: [T-0256]
estimate: 0.3 day
---

# T-0261: forwarding on the wire

## Spec (written by Claude, do not edit)

### Why
`docs/audit/forwarding-plan.md` (T-0256) §3.1 and tasks T-A plus T-B. This is the wire layer only: no store or UI yet, and no behaviour change for existing messages.

### Verified facts (do not re-derive)
- `packages/protocol/src/index.ts` re-exports one module per line (12 lines). Schemas use zod `z.strictObject` (see `packages/protocol/src/payload.ts`).
- `packages/xmpp-core/package.json` depends on `@zilar/protocol` (line 14).
- `packages/xmpp-core/src/namespaces.ts` already has `FORWARD_NAMESPACE = 'urn:xmpp:forward:0'` (line 10, XEP-0297, used by MAM and carbons). The new element needs a **different** constant: `ZILAR_FORWARD_NAMESPACE = 'urn:zilar:forward:0'`.
- `packages/xmpp-core/src/stanza.ts`:
  - `buildMessage(options)` is at line 113, with options `id`, `to`, `kind`, `text`, `payload?`, `replyTo?` and `mentions?`; the store hint logic is at lines 124-134;
  - `decodeMessageStanza(stanza, ctx)` is at line 903.
- `packages/xmpp-core/src/types.ts`: `ChatMessage` at line 38 and `SendMessageOptions` at line 195 (`payload?`, `replyTo?`, `mentions?`).
- `packages/xmpp-core/src/client.ts`: `sendMessage(` at line 930.

### What to build
1. **`packages/protocol/src/forward.ts`:** `ForwardOriginSchema` and `ForwardOrigin`, exactly as in the plan §3.1. The fields are:
   - `sender_id` (1-255) and `sender_name` (1-120);
   - optional `chat_id` (1-255) and `chat_name` (1-120), which must be both present or both absent (enforce it with a refinement);
   - optional `original_id` (1-255);
   - `original_at` (ISO datetime).
   Export it from `index.ts`. Tests in `packages/protocol/src/forward.test.ts`: a valid object, a valid object with a chat, an unknown key rejected, each required field missing, each length cap, a bad datetime, and `chat_id` without `chat_name` rejected.
2. **xmpp-core:**
   - add `ZILAR_FORWARD_NAMESPACE`;
   - `SendMessageOptions.forward?: ForwardOrigin` and `ChatMessage.forward?: ForwardOrigin`;
   - `buildMessage` takes `forward?` and writes `<forward xmlns="urn:zilar:forward:0" sender="…" at="…" id="…"><name>…</name><chat jid="…" name="…"/></forward>`, with `id` and `<chat>` only when present;
   - `sendMessage` passes `forward` through;
   - `decodeMessageStanza` reads it, validates it with `ForwardOriginSchema` and sets `forward`. A malformed element is dropped and the message still decodes; never throw.
3. **Tests in `packages/xmpp-core/src/stanza.test.ts`:**
   - a build-then-decode round trip with and without a chat;
   - a malformed forward (a missing name, or a bad `at`) decodes with no `forward`;
   - a message without the element has no `forward`;
   - an XEP-0297 `urn:xmpp:forward:0` element inside a MAM result is not mistaken for ours (use an existing MAM fixture if there is one).

### Read first
`AGENTS.md`, `docs/audit/forwarding-plan.md` (§3.1 and §4 T-A, T-B), `packages/xmpp-core/src/stanza.ts` (lines 100-200 and 880-1000).

### Allowed files
`packages/protocol/src/forward.ts` (new), `packages/protocol/src/forward.test.ts` (new), `packages/protocol/src/index.ts`, `packages/xmpp-core/src/namespaces.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/stanza.ts`, `packages/xmpp-core/src/client.ts`, `packages/xmpp-core/src/stanza.test.ts`, `work/T-0261-forward-wire.md`.

### Checks
```bash
pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot forward
pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot stanza
pnpm gate
```

### Acceptance
- A message can carry a validated forward origin both ways. Existing stanzas decode exactly as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Stores, UI, the server, and mobile.

---

## Report (written by the worker when done)

## Review (written by Claude)
