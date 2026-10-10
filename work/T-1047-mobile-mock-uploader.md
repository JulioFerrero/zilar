---
id: T-1047
title: "Mobile mock mode: a no-network mock uploader, so voice notes and attachments send instead of failing"
status: merged
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

### What I did

- Added `apps/mobile/src/mock/uploader.ts` exporting `createMockUploader(): AttachmentUploader` (typed against the port in `apps/mobile/src/lib/attachment-ports.ts:55-73`).
  - `upload` reports progress `0.5`, waits a short timer, reports `1`, waits again, then resolves — no network. `onProgress` is optional. The work runs as an `Effect` (`Effect.sleep` + `Effect.sync`), run through `Effect.runPromise`, like `apps/mobile/src/lib/attachment-uploader.ts`.
  - `cancel(messageId)` marks that message's pending upload so its `upload` rejects with `new Error('cancelled')` (the shape `apps/mobile/src/lib/attachment-uploader.ts:45` uses) and clears its slot. Each upload is keyed by message id (falling back to the file URI), so other messages' uploads keep running.
- Wired it in `mockStoreDeps()` in `apps/mobile/src/store/chat-store-provider.tsx`: added `uploader: createMockUploader()` (line 78) after `...sharedDeps()`, loaded with the same guarded `require('../mock/uploader')` as `../mock/backend` (line 72). No other app or package change.

### Acceptance evidence

- `realStoreDeps()` still uses the real uploader: it spreads `sharedDeps()`, whose `uploader: createAttachmentUploader()` is at `apps/mobile/src/store/chat-store-provider.tsx:52`; `realStoreDeps()` (line 89+) does not override `uploader`.
- The mock uploader is reached only through `mockStoreDeps()`: `createMockUploader` appears only at line 72 (the guarded `require`) and line 78 (inside the `mockStoreDeps()` body), both inside the `if (process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)` block.

### Files changed

- `apps/mobile/src/mock/uploader.ts` (new)
- `apps/mobile/src/store/chat-store-provider.tsx` (mock wiring only)
- `work/T-1047-mobile-mock-uploader.md` (status + this Report)

### Commands and results

- `pnpm install`: done (1172 packages, 18.7s; one pre-existing peer-dependency warning for `@types/react-dom`).
- `pnpm --filter @zilar/mobile typecheck`: passed (no output from `tsc --noEmit`).
- `pnpm gate` (from repo root, base `main`) summary:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.4s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (3.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

- Single test files run while working: none. The change is mock wiring plus a new `apps/mobile/src/mock/` file (no existing test targets either; tests in `mock/` are exempt by policy). The gate's `tests @zilar/mobile` step ran the mobile suite once and passed.

### Problems / deviations

- None. The spec offered "Effect or plain timers"; I used Effect to match the real uploader (`apps/mobile/src/lib/attachment-uploader.ts`) and the project's Effect style. The file is under `mock/`, which the effect ratchet treats as exempt, so the `effect` step is unaffected either way.
- No test was added: this is dev-only mock/UI code (AGENTS.md: UI code gets no tests; the lead's phone smoke covers it).

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The change:** a new `apps/mobile/src/mock/uploader.ts` (`createMockUploader`) reports progress `0.5` and `1` on short sleeps, with a per-message cancel that rejects with `new Error('cancelled')`.
  - It is wired only in `mockStoreDeps()`, behind the same guarded `require` as `../mock/backend`.
  - `sharedDeps()` and `realStoreDeps()` keep `createAttachmentUploader()`.
  - The voice port takes the uploader from the same deps (`store/effects/ports.ts:123-130`).
- **The nit:** cosmetic.
- **The lead's phone smoke** (mock, Ana's chat):
  - a 2.5 s mic hold now sends: the bubble shows Play voice message, 0:02 and 1x, with no "Could not send";
  - the demo `tickets.pdf`, attached and sent, also shows no send error.
- **Still a mock gap:** the sent file reads "Not loaded: untrusted address", because the fake slot's `getUrl` is a `data:` URL. The seeded attachments read the same. It is a mock follow-up.
- **Check:** the gate passed.
