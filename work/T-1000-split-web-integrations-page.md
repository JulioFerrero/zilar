---
id: T-1000
title: "Size split T69: apps/web/src/routes/IntegrationsPage.tsx (548 lines) into components/settings/{integrationErrors,EmailCard,VoiceTranscriptionCard,TelegramCard,useIntegrationSave}"
status: todo
milestone: M5
branch: task/T-1000-split-web-integrations-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1000: Split `IntegrationsPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/IntegrationsPage.tsx` is 548 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #65 (task T69). The new files go in a new `apps/web/src/components/settings/` folder: `integrationErrors.ts`, `EmailCard.tsx`, `VoiceTranscriptionCard.tsx` and `TelegramCard.tsx`. The page keeps the loader and every export it has today.

- **In scope:** the in-file Dedup. The three cards' "clear error → save → clear input → reload → `onSaved`" skeleton becomes one `useIntegrationSave`, in `components/settings/useIntegrationSave.ts`.
- **Same behaviour:** each card keeps its own texts and fields, and a saved secret is never shown back.

The lead checks it in Chrome in mock mode: the email card's save, and the Telegram card's remove.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #65, and `apps/web/src/routes/IntegrationsPage.tsx`.

### Allowed files
`apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/components/settings/integrationErrors.ts`, `apps/web/src/components/settings/EmailCard.tsx`, `apps/web/src/components/settings/VoiceTranscriptionCard.tsx`, `apps/web/src/components/settings/TelegramCard.tsx`, `apps/web/src/components/settings/useIntegrationSave.ts`, `work/T-1000-split-web-integrations-page.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names the page's route.

---

## Report (written by the worker when done)

## Review (written by Claude)
