---
id: T-1751
title: "Blocks B2: the server builds and checks a blocks payload (buildBlocksPayload), with a short reason the model can read when it fails"
status: merged
milestone: M5
branch: task/T-1751-blocks-build
model: auto
effort: default
depends_on: [T-1749]
estimate: 25 min
---

# T-1751: Build a blocks payload on the server

## Spec (written by Claude, do not edit)

### Why
Message blocks (`docs/plan/message-blocks.md`, task B2 in §6) need one server helper. It turns the blocks an AI or a saved tool produced into a checked `blocks` payload. Two later tasks call it: the `post_blocks` AI tool (B6) and saved-tool and routine output (B7). On bad input it must return a short reason the model can read, never a throw.

### Facts (read by the lead on 2026-10-16)
- **The `blocks` payload kind** (T-1749):
  - `{ v: 0, type: 'blocks', data: BlocksDataSchema }` in `packages/protocol/src/payload.ts` (the last union member);
  - `BlocksDataSchema` is in `packages/protocol/src/blocks.ts:80-98`. Its fields:
    - `title?`, `icon?` and `meta?`;
    - a required `fallback` of 1–1000 characters;
    - `blocks` (1–12 items, at most 16 KiB serialized).
  - Everything is exported from `@zilar/protocol` (`packages/protocol/src/index.ts`).
- **The server already turns schema failures into a value-free reason** for the model:
  - `firstIssueReason` at `apps/server/src/agents/tool-arg-issues.ts:14`;
  - its caller pattern at `apps/server/src/agents/tools/parse.ts:310-328`: `Schema.decodeUnknownExit(schema, { errors: 'all', onExcessProperty: 'error' })`, then the first `Fail` reason's `issue`.
- **`encodePayload`** (`packages/protocol/src/payload.ts`) throws past the 64 KiB payload cap.
- **Don't use `apps/server/src/blocks/`:** it's the *user blocking* module (`apps/server/src/blocks/api.ts`). This helper goes in a new `apps/server/src/message-blocks/` folder.

### Steps
1. **Create `apps/server/src/message-blocks/build.ts`** with:
   ```ts
   export type BlocksInput = { title?: unknown; icon?: unknown; meta?: unknown; blocks: unknown };
   export function buildBlocksPayload(
     input: BlocksInput,
     fallback: string,
   ): { ok: true; payload: Payload } | { ok: false; reason: string };
   ```
   - **The fallback:** trim it and cut it to 1000 characters. If it's empty, return `{ ok: false, reason: 'fallback text is required' }`.
   - **Decode** `{ ...input, fallback }` with `BlocksDataSchema`, strict, the same way as `parse.ts:310-328`. Leave out the keys of `input` that are `undefined` before decoding, so an absent `title` isn't an excess key.
     - On failure, return `firstIssueReason(...)` or `'invalid blocks'`.
   - **On success,** build `{ v: 0, type: 'blocks', data }` and call `encodePayload` inside try/catch; a throw returns `{ ok: false, reason: 'blocks payload is too large' }`.
   - Then return `{ ok: true, payload }`.
   - Add a short comment on what the function is for and who calls it (B6, B7).
2. **Tests (message pipeline, 2)** in a new `apps/server/src/message-blocks/build.test.ts`:
   - a `figure` block plus a `callout` block, with the title "BTC" and fallback "BTC $82,302", builds; `payload.type === 'blocks'` and `payload.data.fallback === 'BTC $82,302'`;
   - a `link` block with a title and `url: 'http://example.com'` returns `ok: false` with a reason that mentions `https`. If `firstIssueReason` gives no reason for this filter, assert only `ok: false` and say so in the Report.

### Allowed files
- `apps/server/src/message-blocks/build.ts`
- `apps/server/src/message-blocks/build.test.ts`
- `work/T-1751-blocks-build.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/build.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `buildBlocksPayload` returns a checked `blocks` payload, or a short reason, and never throws.
- The 2 tests and the gate pass.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/message-blocks/build.ts` with `buildBlocksPayload(input, fallback)`.
  It trims the fallback and cuts it to 1000 chars, fails with `fallback text is required`
  when empty, drops `undefined` keys from the input so an absent `title`/`icon`/`meta` is
  not an excess key, then decodes `{ ...input, fallback }` with `BlocksDataSchema` using
  `Schema.decodeUnknownExit(..., { errors: 'all', onExcessProperty: 'error' })` — the same
  strict pattern as `apps/server/src/agents/tools/parse.ts:310-328`. On failure it returns
  the first `firstIssueReason(...)`, falling back to `invalid blocks`. On success it builds
  `{ v: 0, type: 'blocks', data }` and calls `encodePayload` in a try/catch; a throw returns
  `blocks payload is too large`.
- Added `apps/server/src/message-blocks/build.test.ts` with the two message-pipeline tests.
- Changed files: `apps/server/src/message-blocks/build.ts`, `apps/server/src/message-blocks/build.test.ts`, `work/T-1751-blocks-build.md`.

### Checks run
- `pnpm install` — Done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/build.test.ts` — `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm gate` (repo root) — summary:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Notes for the lead
- The `link`/http test does get a usable reason from `firstIssueReason`: the failure is
  `must be an https URL`, so the test asserts the reason `toContain('https')` as the spec's
  preferred path. No fallback assertion was needed.

## Review (written by Claude)

- **Accepted at `1525d4d1d`.** It's clean (2 nits). The lead ran `build.test.ts`: 2 pass.
- **`buildBlocksPayload`:**
  - it trims the fallback and cuts it to 1000 characters;
  - it decodes strictly with `BlocksDataSchema`;
  - it returns `firstIssueReason`'s value-free reason, and never throws.
- **The nits are accepted:**
  - the "too large" branch is a guard that can't currently fire, because the 16 KiB block cap keeps the payload far below 64 KiB;
  - unknown top-level keys are dropped rather than rejected, which is fine for model output.
- **Next:** B6 (the `post_blocks` AI tool) and B7 (saved-tool and routine output) call it.

