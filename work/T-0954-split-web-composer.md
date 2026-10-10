---
id: T-0954
title: "Size split T13: apps/web/src/components/Composer.tsx (1,145 lines) into composer/{useVoiceRecorder,useComposerAttachments,useMentions}.ts + composer/ComposerControls.tsx, the old path the component"
status: todo
milestone: M5
branch: task/T-0954-split-web-composer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0954: Split `Composer.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/Composer.tsx` is 1,145 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #9 (task T13): the hooks `composer/useVoiceRecorder.ts`, `composer/useComposerAttachments.ts` and `composer/useMentions.ts`, plus `composer/ComposerControls.tsx`, under `apps/web/src/components/`.

`Composer.tsx` keeps the `Composer` component, which composes the hooks and controls, and every export it has today.

There are no web UI tests (Julio's rule). The lead checks the composer in Chrome in mock mode: text, mention, sticker, GIF, attachment and voice.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #9, and `apps/web/src/components/Composer.tsx`.

### Allowed files
`apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/useVoiceRecorder.ts`, `apps/web/src/components/composer/useComposerAttachments.ts`, `apps/web/src/components/composer/useMentions.ts`, `apps/web/src/components/composer/ComposerControls.tsx`, `work/T-0954-split-web-composer.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
