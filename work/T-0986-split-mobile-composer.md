---
id: T-0986
title: "Size split T30: apps/mobile/src/components/chat/composer.tsx (788 lines) into chat/{composer-media,composer-sheet,use-composer-mentions,composer-input-row}; one captionOptions + clearDraft"
status: todo
milestone: M5
branch: task/T-0986-split-mobile-composer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0986: Split the mobile composer

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/composer.tsx` is 788 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #26 (task T30): `components/chat/composer-media.ts`, `chat/composer-sheet.ts`, `chat/use-composer-mentions.ts`, `chat/composer-input-row.tsx`, under `apps/mobile/src/`. `composer.tsx` keeps the `Composer` and every export it has today.

- **Existing file:** `components/chat/composer-mentions.ts` already exists. Leave it as it is, and import from it if you need to.
- **In scope:** the in-file Dedup. `sendGif` and `handleSend` share one `captionOptions(text, replyTo)` and one `clearDraft()`.
- **Same behaviour:** this is the message send path, so the message options sent must stay exactly the same.

The lead runs a phone smoke of a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #26, and `apps/mobile/src/components/chat/composer.tsx`.

### Allowed files
`apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/composer-sheet.ts`, `apps/mobile/src/components/chat/use-composer-mentions.ts`, `apps/mobile/src/components/chat/composer-input-row.tsx`, `work/T-0986-split-mobile-composer.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
