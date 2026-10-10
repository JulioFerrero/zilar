---
id: T-0988
title: "Size split T38: apps/mobile/src/app/settings/integrations.tsx (740 lines) into components/integrations/{card-fields,email-card,voice-card,telegram-card,use-card-actions}"
status: todo
milestone: M5
branch: task/T-0988-split-mobile-integrations
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0988: Split the mobile integrations screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/integrations.tsx` is 740 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #34 (task T38). The new files go in `apps/mobile/src/components/integrations/`:
- `card-fields.tsx`, `email-card.tsx`, `voice-card.tsx`, `telegram-card.tsx`;
- `use-card-actions.ts`.

The screen keeps the loader and the wiring of the three cards.

- **Existing files:** the folder already holds `card-save.ts`, `errors.ts`, `integrations-mock.ts` and `use-integrations-api.ts`. Leave them as they are.
- **In scope:** the in-file Dedup. `use-card-actions.ts` holds one save state machine and one remove state machine, used by all three cards.
- **Same behaviour:** each card keeps its own texts and fields. A saved secret must still never be shown back in the field, so keep `SecretField` exactly as it is.

The lead runs a phone smoke of `/settings/integrations` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #34, `apps/mobile/src/app/settings/integrations.tsx`, and `apps/mobile/src/components/integrations/card-save.ts`.

### Allowed files
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/components/integrations/card-fields.tsx`, `apps/mobile/src/components/integrations/email-card.tsx`, `apps/mobile/src/components/integrations/voice-card.tsx`, `apps/mobile/src/components/integrations/telegram-card.tsx`, `apps/mobile/src/components/integrations/use-card-actions.ts`, `work/T-0988-split-mobile-integrations.md`.

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
