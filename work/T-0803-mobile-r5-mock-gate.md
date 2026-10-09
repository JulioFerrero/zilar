---
id: T-0803
title: "R5: mobile reads EXPO_PUBLIC_ZILAR_MOCK and EXPO_PUBLIC_ZILAR_MOCK_SCENARIO once, in mock/gate.ts; the 14 use-*-api hooks and chat-store-provider import the values"
status: merged
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

- **Done:** `mock/gate.ts` exports `ENV_MOCK`, `ENV_MOCK_SCENARIO`, `ENV_NODE_ENV` (each a literal `process.env.*` read) and `MOCK_ENV` (`{ EXPO_PUBLIC_ZILAR_MOCK, EXPO_PUBLIC_ZILAR_MOCK_SCENARIO }`, passed to the 8 scenario readers that took an inline object). The 14 hooks and `chat-store-provider.tsx` import these. No `process.env` read is left in the 15 listed files.
- **effect:map kinds (after):** all 14 hooks and `chat-store-provider.tsx` are `plain` (were `needs-effect`, signal W7). `mock/gate.ts` is `exempt` (path `mock/`). The acceptance asks for `effect`, which I did not reach: these files do no async work and import nothing from Effect, so `plain` is the honest result. Total needs-effect 167 -> 153. Tell me if you want an Effect import added anyway.
- **Tests:** `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/mock src/components src/store/chat-store-provider`: 127 files, 1066 passed, 0 failed (last run, after the final edit). Before-count not measured; the only test added is `mock env constants` in `gate.test.ts` (1 test). No timers or concurrency in the changed code, so the 3-run rule was not applied.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` exit 0.
- **Behaviour differences:**
  - The env values are read once when `mock/gate.ts` loads, not on each render (hooks) or in the provider's `useState` initializer. In the bundle the literal reads are inlined, so the values are the same. In tests, a change to `process.env` after import would no longer reach these hooks; no test in the repo does that for these variables.
  - The 8 scenario readers now receive the shared `MOCK_ENV` object instead of a fresh object literal per render. They only read it.
  - Comments that described the inlining were removed from the 7 hooks that had them (the comment now sits in `gate.ts`).
  - Exports, signatures and texts of the hooks are unchanged.
- **Not changed (outside Allowed files), still read `process.env` directly:** `components/chat/composer.tsx:294`, `store/chat-store.ts:1571` (`currentMockEnv`), `app/chat/[id].tsx` (3 places), `app/(tabs)/index.tsx:84`, plus mock files under `mock/` and `components/*-mock.ts`. Those are the next wave's job, if the plan wants them.
- **Unsure:** (1) the brief is in commit d93ceb70 on this repo, not in the worktree checkout; I read it with `git show` and followed it. (2) The "effect" acceptance vs `plain` result, see above.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Haiku 5.5. The mock env is read once in `mock/gate.ts`, and 15 readers import it; plain is accepted. Follow-up: the remaining `process.env` reads in composer, chat-store, `chat/[id]` and `(tabs)/index` belong to MU8, MU16 and MU6.
