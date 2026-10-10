---
id: T-0969
title: "Size split T33: packages/client-core/src/store/send.ts (883 lines) into store/send/{context,pipeline,text,voice,attachment,sticker,forward,failed}.ts, the old path a barrel"
status: todo
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

## Review (written by Claude)
