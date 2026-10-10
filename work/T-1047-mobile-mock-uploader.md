---
id: T-1047
title: "Mobile mock mode: a no-network mock uploader, so voice notes and attachments send instead of failing"
status: todo
milestone: M5
branch: task/T-1047-mobile-mock-uploader
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.25 day
---

# T-1047: Mobile mock uploader

## Spec (written by Claude, do not edit)

### Why
In mobile mock mode, a recorded voice note ends with "Could not send. Check your connection." (lead phone smokes T-1012 and T-1030, 2026-10-10). The cause is in two places:
- the fake XMPP core's upload slot is a `data:` URL (`packages/mock-backend/src/xmpp/core.ts:227-231`);
- the mobile uploader then PUTs the file natively to that URL (`apps/mobile/src/lib/attachment-uploader.ts:26-27`), which fails.

Mock mode needs an uploader that does no network. It must stay a dev-only build: the mock code loads only behind the literal build condition in `apps/mobile/src/store/chat-store-provider.tsx:68` (plan risk R6 in `docs/audit/mock-plan.md`).

### What to build
1. **The mock uploader:** a new `apps/mobile/src/mock/uploader.ts` exports `createMockUploader(): AttachmentUploader`, typed against the port in `apps/mobile/src/lib/attachment-ports.ts:55-73`.
   - **`upload`:** reports progress `0.5`, then `1`, on short timers (`onProgress` is optional), then resolves with no network.
   - **`cancel(messageId)`:** makes that message's pending `upload` reject with `new Error('cancelled')`, the shape `attachment-uploader.ts:45` uses. Other messages' uploads keep running.
   - Use Effect or plain timers the way `apps/mobile/src/mock/` files already do. It must pass the gate's effect step.
2. **Wiring:** in `mockStoreDeps()` (`apps/mobile/src/store/chat-store-provider.tsx:66-87`), set `uploader: createMockUploader()` after `...sharedDeps()`.
   - Load it with the same guarded `require` as `../mock/backend`.
   - `realStoreDeps()` and `sharedDeps()` stay unchanged, so real builds keep the real uploader.
3. **No other app or package change.**

The lead runs a phone smoke in mock mode: hold the mic in Ana's chat, then attach the demo `tickets.pdf` and send it. Neither should end in "Could not send".

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` (risk R6), `apps/mobile/src/lib/attachment-ports.ts`, `apps/mobile/src/lib/attachment-uploader.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, and `apps/mobile/src/mock/backend.ts`.

### Allowed files
`apps/mobile/src/mock/uploader.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `work/T-1047-mobile-mock-uploader.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report shows that `realStoreDeps()` still uses `createAttachmentUploader()`, and that the mock uploader is only reached through `mockStoreDeps()`.

---

## Report (written by the worker when done)

## Review (written by Claude)
