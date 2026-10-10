---
id: T-0969
title: "Size split T33: packages/client-core/src/store/send.ts (883 lines) into store/send/{context,pipeline,text,voice,attachment,sticker,forward,failed}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0969-split-store-send
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0969: Split the core `send.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/client-core/src/store/send.ts` is 883 lines (`wc -l`, main, 2026-10-10).

The plan read it at 778 lines. Since then, T-0929 (`a0ffb41e`, the mobile send on the core: the R6 deadline and R18 sticky failure) added about 105 lines, so the plan's ranges are only a guide.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #29 (task T33): `store/send/context.ts`, `store/send/pipeline.ts`, `store/send/text.ts`, `store/send/voice.ts`, `store/send/attachment.ts`, `store/send/sticker.ts`, `store/send/forward.ts`, `store/send/failed.ts`, under `packages/client-core/src/`. `store/send.ts` becomes the barrel. Put T-0929's code with the send kind it serves; shared deadline helpers go in `pipeline.ts`.

- **This is the message pipeline, the most crucial code in the app.** Move it byte-identical.
- **Skip the entry's Dedup** (`runSendPipeline`, `failedMessageFor`): it changes logic, so it can be its own task later with tests.
- **Prove it in the Report:** a normalised diff of each old range against its new home that is empty except for added `export` keywords and import lines (the method T-0965 used).

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #29, and `packages/client-core/src/store/send.ts`.

### Allowed files
`packages/client-core/src/store/send.ts`, `packages/client-core/src/store/send/context.ts`, `packages/client-core/src/store/send/pipeline.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send/voice.ts`, `packages/client-core/src/store/send/attachment.ts`, `packages/client-core/src/store/send/sticker.ts`, `packages/client-core/src/store/send/forward.ts`, `packages/client-core/src/store/send/failed.ts`, `work/T-0969-split-store-send.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot src/store/send.test.ts src/store/incoming.test.ts src/store/ledger.test.ts
pnpm gate
```
The gate also runs the web and mobile store tests near it, if it picks them.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the normalised range diffs.

---

## Report (written by the worker when done)

### What I did

Split `packages/client-core/src/store/send.ts` (883 lines on the branch, 778 on
`a64ac2b6`) into the eight files of `docs/audit/size-plan.md` §2.2 #29, under
`packages/client-core/src/store/send/`. `send.ts` is now a 30-line barrel that
re-exports the same 16 names, with the same kinds (5 types, 11 values). Code was
moved byte-identical; the only additions are import lines, the trailing
`export { ... }` lines that expose the helpers the halves share, and the barrel
re-exports. The entry's **Dedup was skipped** on purpose, as the spec says (that
is `runSendPipeline` / `failedMessageFor`, a later task with tests).

No importer changed. `packages/client-core/src/store/index.ts` still does
`export * from './send'`, `send.test.ts` still imports `./send`, and mobile's
`apps/mobile/src/store/effects/send.ts` still imports `disarmSend`,
`sendText`, `forwardMessages`, `retryVoice`, `retryAttachment`, `retrySticker`,
`sendAttachment`, `sendSticker`, `type SendCtx` from `@zilar/client-core/store`.
The barrel keeps all of them.

### Files changed

- `packages/client-core/src/store/send.ts` — barrel (was the 883-line source).
- `packages/client-core/src/store/send/context.ts` — new.
- `packages/client-core/src/store/send/pipeline.ts` — new.
- `packages/client-core/src/store/send/text.ts` — new.
- `packages/client-core/src/store/send/voice.ts` — new.
- `packages/client-core/src/store/send/attachment.ts` — new.
- `packages/client-core/src/store/send/sticker.ts` — new.
- `packages/client-core/src/store/send/forward.ts` — new.
- `packages/client-core/src/store/send/failed.ts` — new.
- `work/T-0969-split-store-send.md` — this Report and the status change.

### Sizes (`wc -l`) — split-rules item 8

| File | Lines |
| --- | ---: |
| `store/send.ts` (old, branch) | 883 |
| `store/send.ts` (barrel now) | 30 |
| `store/send/context.ts` | 138 |
| `store/send/pipeline.ts` | 94 |
| `store/send/text.ts` | 71 |
| `store/send/voice.ts` | 167 |
| `store/send/attachment.ts` | 169 |
| `store/send/sticker.ts` | 134 |
| `store/send/forward.ts` | 171 |
| `store/send/failed.ts` | 17 |

Every new file and the barrel are well under 400 lines. The plan's ranges, not
its line numbers, were used (they drifted by T-0929's ~100 lines); the largest
new file is `forward.ts` at 171.

### Where each piece went (ranges are the branch file's lines)

- `context.ts`: the shared context and pure helpers — `SendRun`, `SendCtx`
  (including T-0929's `omitEmptyTextOptions`), the option/input types,
  `nextLocalId`, `queueOutgoing`, `rememberMyAuthor`, `clearActionError`,
  `linkSent`, and T-0929's `setUploadProgress` / `clearUploadProgress` (the
  upload-progress mutators used by both attachment and voice, so they live in
  the shared file, not duplicated).
- `pipeline.ts`: the send-attempt machinery — `SEND_TIMEOUT_MS`, `newRun`,
  `timeoutKey`, `armSendTimeout`, `settleSendTimeout`, `isCurrentSendRun`,
  `settleFailure`, and T-0929's shared deadline/lifecycle helpers `messageAlive`
  and `disarmSend` (the spec says shared deadline helpers go here).
- `text.ts`: `sendText` (510–573). `voice.ts`: `runVoiceSend`, `sendVoice`,
  `retryVoice`. `attachment.ts`: `runAttachmentUpload`, `sendAttachment`,
  `retryAttachment`. `sticker.ts`: `runStickerSend`, `sendSticker`,
  `retrySticker`. `forward.ts`: `forwardPublicRoomFor`, `forwardOriginFor`,
  `runForwardSend`, `forwardMessages`. `failed.ts`: `deleteFailedMessage`.
  T-0929's edits (the cancel guards, the progress wiring, the `info` parameter,
  `sendText`'s `sendOptions`, `retryAttachment`'s `describe`) moved with the
  function they belong to.

### Export list before / after — split-rules item 8

Before (old `send.ts`, `grep -nE '^export'`): 16 names —
`SEND_TIMEOUT_MS`, `SendRun`, `SendCtx`, `SendTextOptions`,
`SendAttachmentOptions`, `SendStickerInput`, `disarmSend`, `sendText`,
`sendVoice`, `retryVoice`, `deleteFailedMessage`, `sendAttachment`,
`sendSticker`, `forwardMessages`, `retrySticker`, `retryAttachment`.

After (barrel `send.ts`):

```
export type {
  SendAttachmentOptions,
  SendCtx,
  SendRun,
  SendStickerInput,
  SendTextOptions,
} from './send/context';
export { deleteFailedMessage } from './send/failed';
export { forwardMessages } from './send/forward';
export { disarmSend, SEND_TIMEOUT_MS } from './send/pipeline';
export { retrySticker, sendSticker } from './send/sticker';
export { sendText } from './send/text';
export { retryAttachment, sendAttachment } from './send/attachment';
export { retryVoice, sendVoice } from './send/voice';
```

Same 16 names, same kinds. The submodules additionally export the helpers that
were module-private before so the other halves can import them
(`context.ts`: `nextLocalId`, `queueOutgoing`, `rememberMyAuthor`,
`clearActionError`, `linkSent`, `setUploadProgress`, `clearUploadProgress`;
`pipeline.ts`: `newRun`, `armSendTimeout`, `settleSendTimeout`,
`isCurrentSendRun`, `messageAlive`, `settleFailure`). The barrel does not
re-export those, so the public surface is unchanged.

### Normalised range diffs — old range vs new home (T-0965's method)

Each module's old range was extracted from the branch `send.ts`, then diffed
against its new file with import statements and `export`/`export { ... }` lines
removed. The normalised diff is **empty (IDENTICAL) for all eight**:

```
context.ts    normalised IDENTICAL
pipeline.ts   normalised IDENTICAL
text.ts       normalised IDENTICAL
voice.ts      normalised IDENTICAL
attachment.ts normalised IDENTICAL
sticker.ts    normalised IDENTICAL
forward.ts    normalised IDENTICAL
failed.ts     normalised IDENTICAL
```

The raw changed lines are only the added imports and export statements, e.g.:

```
=== context.ts ===
> import type { Deferred } from 'effect';
> import type { ChatSummary, ReplyRef, UiMention } from '@zilar/chat-core';
> import type { CoreCtx } from '../ctx';
> import type { CorePorts, SendPorts } from '../ports';
> export {
>   clearActionError, clearUploadProgress, linkSent, nextLocalId,
>   queueOutgoing, rememberMyAuthor, setUploadProgress,
> };
=== pipeline.ts ===
> import { Cause, Deferred, Effect } from 'effect';
> import type { SendCtx, SendRun } from './context';
> import { sendFailureReasonFor } from '../send-failure';
> export { armSendTimeout, isCurrentSendRun, messageAlive, newRun, settleFailure, settleSendTimeout };
=== text.ts / voice.ts / attachment.ts / sticker.ts / forward.ts / failed.ts ===
> only `import ...` lines (no export block needed: their public functions were already `export`)
```

`linkSent`'s declaration is >100 columns once `export ` is inline, so the shared
helpers are exposed with a trailing `export { ... }` line instead of an inline
`export ` keyword. That keeps every moved declaration byte-identical and avoids
prettier rewrapping it.

### Effect ratchet

No `// effect-plain:` marker was needed, and none was added. `pipeline.ts`,
`text.ts`, `voice.ts`, `attachment.ts`, `sticker.ts` and `forward.ts` import
`effect` as a value (`Effect`/`Cause`/`Deferred`), so the map classifies them
`effect`; `context.ts` and `failed.ts` are pure and classify `plain`. The gate's
`effect` step passed.

### Commands and results

- `pnpm install` — done (only the pre-existing `@types/react` peer warning for
  `apps/mobile`).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` — **1 file, 11 tests passed**.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts src/store/ledger.test.ts` — **2 files, 24 tests passed**.
- `pnpm gate` from the repo root:

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.5s)
PASS  lint  (0.7s)
PASS  typecheck  (3.3s)
PASS  effect  (0.6s)
PASS  tests @zilar/client-core  (1.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

1. The plan's line ranges (from `a64ac2b6`, 778 lines) no longer matched the
   branch (883 lines): T-0929 had inserted the progress mutators, `messageAlive`,
   `disarmSend`, `omitEmptyTextOptions` and the cancel guards. I grouped by the
   plan's file names and moved T-0929's code with the send kind it serves; the
   shared deadline/lifecycle helpers went to `pipeline.ts` as the spec states.
2. **Dedup skipped** exactly as specified: `runSendPipeline` and
   `failedMessageFor` are not introduced.
3. A `disarmSend` was already exported by the branch before this task (T-0929);
   the barrel keeps exporting it so mobile's `effects/send.ts` still works.

No open questions, no blocked items.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `store/send.ts` (883 lines) becomes a barrel plus the 8 `store/send/*.ts` files, the largest `forward.ts` at 171.
- **Byte-identical:** the normalised range diffs are IDENTICAL, and the 16-name public surface is unchanged. T-0929's deadline code went with the send kinds it serves.
- **Check:** the 35 send, incoming and ledger tests pass, and so does the gate.
