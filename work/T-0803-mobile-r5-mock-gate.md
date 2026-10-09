---
id: T-0803
title: "R5: mobile reads EXPO_PUBLIC_ZILAR_MOCK and EXPO_PUBLIC_ZILAR_MOCK_SCENARIO once, in mock/gate.ts; the 14 use-*-api hooks and chat-store-provider import the values"
status: todo
milestone: M5
branch: task/T-0803-mobile-r5-mock-gate
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0803: R5: mobile reads EXPO_PUBLIC_ZILAR_MOCK and EXPO_PUBLIC_ZILAR_MOCK_SCENARIO once, in mock/gate.ts; the 14 use-*-api hooks and chat-store-provider import the values

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row R5, line 315.

### Verified facts (do not re-derive)
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*` expression** (`apps/mobile/src/lib/auth.ts:19-22`), so the read must stay a literal expression. It moves to one place, `apps/mobile/src/mock/gate.ts`, which today exports `mockParamAllowed(env)` (lines 7-15).
- **The readers** (W7 env read, plan appendix):
  - `components/ais/use-ai-memory-api.ts:43`, `use-ais-api.ts:20`, `use-audit-api.ts:43`, `use-tools-api.ts:44`;
  - `components/chat/use-approvals-api.ts:44`, `use-invites-api.ts:22`;
  - `components/connections/use-connections-api.ts:24`, `components/contacts/use-contacts-api.ts:22`, `components/directory/use-directory-api.ts:24`, `components/integrations/use-integrations-api.ts:24`, `components/machines/use-machines-api.ts:24`;
  - `components/settings/use-profile-api.ts:24`, `components/stickers/use-stickers-api.ts:25`;
  - `store/chat-store-provider.tsx:47`.
- **Example reader:** `use-ais-api.ts:18-25` reads `process.env.EXPO_PUBLIC_ZILAR_MOCK` and `process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO`. `chat-store-provider.tsx:44-50` reads `EXPO_PUBLIC_ZILAR_MOCK` and `NODE_ENV`.
- **The test** is `apps/mobile/src/mock/gate.test.ts`.

### What to build
In `mock/gate.ts`, export `ENV_MOCK = process.env.EXPO_PUBLIC_ZILAR_MOCK` and `ENV_MOCK_SCENARIO = process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO` (and `NODE_ENV` if the provider needs it). Then replace each reader's `process.env.*` with the import. Add a gate test that the constants exist. Leave `lib/auth.ts` (the API URL) as is.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/mobile/src/mock/gate.ts`, `gate.test.ts`, `apps/mobile/src/lib/auth.ts:15-25`, and each listed reader.

### Allowed files
`apps/mobile/src/mock/gate.ts`, `apps/mobile/src/mock/gate.test.ts`, `apps/mobile/src/components/ais/use-ai-memory-api.ts`, `apps/mobile/src/components/ais/use-ais-api.ts`, `apps/mobile/src/components/ais/use-audit-api.ts`, `apps/mobile/src/components/ais/use-tools-api.ts`, `apps/mobile/src/components/chat/use-approvals-api.ts`, `apps/mobile/src/components/chat/use-invites-api.ts`, `apps/mobile/src/components/connections/use-connections-api.ts`, `apps/mobile/src/components/contacts/use-contacts-api.ts`, `apps/mobile/src/components/directory/use-directory-api.ts`, `apps/mobile/src/components/integrations/use-integrations-api.ts`, `apps/mobile/src/components/machines/use-machines-api.ts`, `apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/components/stickers/use-stickers-api.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `work/T-0803-mobile-r5-mock-gate.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/mock src/components src/store/chat-store-provider
pnpm --filter @zilar/mobile typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
