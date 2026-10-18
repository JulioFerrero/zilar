---
id: T-2070
title: "Reduce (phone): one API mock gate (16 identical xMockActive copies) and one useMockableApi hook (12 identical 'real or mock API' hooks with their build-guarded mock factory) — no behaviour change, the mock stays out of release bundles"
status: merged
milestone: M5
branch: task/T-2070-phone-mock-gate
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2070: One phone mock gate and one mockable-API hook

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down. The phone has the same "is the API mock on?" function **16 times**, and the same "real or mock API" hook 12 times.

### Facts (read by the lead on 2026-10-18 at `005d1e4a2`)
1. **The gate.** These 16 files each define a private gate with the same body; the comments differ. The function is named `<x>MockActive(envMock, params, paramAllowed)`, and the body is:
   - `rawParam = params['mock']`;
   - `param` is the first value when allowed;
   - `requested = param ?? envMock`;
   - `''`, `'0'` and undefined mean off; `'false'` means off; anything else means on.

   The files:
   - `apps/mobile/src/app/settings/devices.tsx`
   - `apps/mobile/src/app/settings/notifications.tsx`
   - `apps/mobile/src/components/ais/use-ai-memory-api.ts`
   - `apps/mobile/src/components/ais/use-ais-api.ts`
   - `apps/mobile/src/components/ais/use-audit-api.ts`
   - `apps/mobile/src/components/ais/use-tools-api.ts`
   - `apps/mobile/src/components/chat/link-preview-card.tsx`
   - `apps/mobile/src/components/chat/steps-sheet.tsx`
   - `apps/mobile/src/components/chat/use-approvals-api.ts`
   - `apps/mobile/src/components/connections/use-connections-api.ts`
   - `apps/mobile/src/components/contacts/use-contacts-api.ts`
   - `apps/mobile/src/components/directory/use-directory-api.ts`
   - `apps/mobile/src/components/integrations/use-integrations-api.ts`
   - `apps/mobile/src/components/machines/use-machines-api.ts`
   - `apps/mobile/src/components/settings/use-profile-api.ts`
   - `apps/mobile/src/components/stickers/use-stickers-api.ts`

   No test imports these functions. The lead checked with `git grep "MockActive"` on `*.test.*`.
2. **The hook.** The 12 `use-*-api.ts` files (in the list above) also repeat:
   - `createMockX()`: inside the literal `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`, it does `require('@/mock/backend')` and returns `createXApi(mockToken, mockFetch, API_URL)`, and otherwise throws;
   - `useXApi()`: `useGlobalSearchParams()`, then the gate with `ENV_MOCK` and `mockParamAllowed({ dev: __DEV__, envMock: ENV_MOCK })`, then `useMemo(() => mock ? createMockX() : createXApi(getSessionToken), [mock])`, returning `{ api, mock }`.

   Example: `apps/mobile/src/components/ais/use-ais-api.ts` (62 lines).
3. **The gate module.** `apps/mobile/src/mock/gate.ts` exports `mockParamAllowed`, `isMockMode` (a different rule, for the store), `mockToken` and `ENV_MOCK`.

### Steps
1. **The gate.** Add ONE exported `apiMockActive(envMock, params, paramAllowed): boolean` to `apps/mobile/src/mock/gate.ts`, with the shared body and one short comment. Keep `isMockMode` unchanged. Delete the 16 private copies; each file calls `apiMockActive`.
2. **The hook.** Create `apps/mobile/src/lib/use-mockable-api.ts`:

   ```ts
   useMockableApi<A>(real: () => A, mock: (mockFetch: typeof fetch) => A): { api: A; mock: boolean }
   ```

   - It reads the params, runs the gate, and memoizes on `mock`.
   - It holds the ONLY `require('@/mock/backend')`, inside the same literal `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)` guard, and throws `'The mock API is not part of this build'` otherwise. This keeps Metro folding the mock out of release bundles, so keep the condition literal and the `require` inside it.
   - Each of the 12 `use-*-api.ts` hooks becomes a few lines calling it with module-level `real` and `mock` functions. Keep each hook's exported name and return type, so callers don't change.
   - Where a file's factory differs (`use-profile-api.ts` and `use-stickers-api.ts` return objects), keep its own factory and only use `apiMockActive`. Note this in the Report.
3. **Tests.** No new tests.
4. **Size.** Product lines must go down by at least 250. Report the counts.

### Allowed files
- `apps/mobile/src/mock/gate.ts`
- `apps/mobile/src/lib/use-mockable-api.ts`
- `apps/mobile/src/app/settings/devices.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/components/ais/use-ai-memory-api.ts`
- `apps/mobile/src/components/ais/use-ais-api.ts`
- `apps/mobile/src/components/ais/use-audit-api.ts`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx`
- `apps/mobile/src/components/chat/use-approvals-api.ts`
- `apps/mobile/src/components/connections/use-connections-api.ts`
- `apps/mobile/src/components/contacts/use-contacts-api.ts`
- `apps/mobile/src/components/directory/use-directory-api.ts`
- `apps/mobile/src/components/integrations/use-integrations-api.ts`
- `apps/mobile/src/components/machines/use-machines-api.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/components/stickers/use-stickers-api.ts`
- `work/T-2070-phone-mock-gate.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 250 lower.
- **Lead check, emulator (mock build):** the AIs list, contacts and the devices screen open with mock data.

---

## Report (written by the worker when done)

### What I did

- **Gate.** `apps/mobile/src/mock/gate.ts`: added one exported
  `apiMockActive(envMock, params, paramAllowed)` with the shared body and one
  comment. `isMockMode` is unchanged. All 16 private gates are deleted and their
  callers use `apiMockActive`.
- **Hook.** New `apps/mobile/src/lib/use-mockable-api.ts` (33 lines):
  `useMockableApi<A>(real, mock)` reads `useGlobalSearchParams`, runs
  `apiMockActive` with `ENV_MOCK` and `mockParamAllowed`, and memoizes on the
  gate result. It holds the only `require('@/mock/backend')` for the 12 API
  hooks, inside the literal `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`
  guard, and it throws `The mock API is not part of this build` otherwise.
- **Ten hooks** now have module-level `realXApi` / `mockXApi(mockFetch)`
  functions and a one-line `return useMockableApi(...)`: ais, ai-memory, audit,
  tools, approvals, connections, contacts, directory, integrations, machines.
  Exported hook names, handle interfaces and return shapes are unchanged.
- **Exceptions (as the spec allows).** `use-profile-api.ts` and
  `use-stickers-api.ts` keep their own `createMockProfile` / `createMockStickers`
  factories: profile's `uploadAvatar` needs `mockFetch` directly, and stickers
  also returns `mockViewerId`. Both deleted their private gate and call
  `apiMockActive`; their literal `require` guards are unchanged.
- **The four non-hook files** (`devices.tsx`, `notifications.tsx`,
  `link-preview-card.tsx`, `steps-sheet.tsx`): deleted their private gates, now
  call `apiMockActive`; their own factories and `require` guards are unchanged.
- **Behaviour:** same param precedence (`param ?? env`), same off values
  (`''`, `'0'`, `'false'`, undefined), same mock factories and return shapes.
- **Line counts.** The 16 listed files: 2040 → 1546 lines (−494). With
  `gate.ts` 59 → 79 (+20) and the new 33-line hook, the net product reduction is
  **441 lines**. Size check: every file ≤ 400 lines (largest is
  `notifications.tsx` at 371).

### Checks run

```text
pnpm install -> Done in 32.4s

pnpm gate ->
gate: 19 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (3.4s)
PASS  effect  (1.8s)
SKIP  build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (3.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single-file tests were run: no test imports these hooks or gates
(`git grep MockActive` found no test), and the spec says no new tests.

Two gate rounds before the pass, both fixed inside scope:

1. format failed on `link-preview-card.tsx` and `steps-sheet.tsx` (one long
   line); fixed with `pnpm exec prettier --write` on those two files.
2. the effect ratchet flagged the new hook's `process.env` (W7); added the
   `// effect-plain:` marker explained below.

### Notes for the lead

- The spec asks for the new module to hold the only `require('@/mock/backend')`
  but also says profile and stickers keep their own factory, so those two keep
  theirs. With the four non-hook files also keeping their own factories, the 16
  files go from 16 `require` guards to 7.
- `apps/mobile/src/lib/use-mockable-api.ts` starts with
  `// effect-plain: a React hook; the env guard must stay literal for Metro to fold the mock out`
  because the effect ratchet treats `process.env` as a W7 signal in a new
  non-mock file. The guard is still a literal `if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)`
  with the `require` inside it.
- Emulator check (mock build: AIs list, contacts, devices) was not run here; that
  is the lead's check.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `apiMockActive` in `mock/gate.ts` replaces 16 copies, and one `useMockableApi(real, mock)` replaces 10 hook bodies. Profile and stickers keep their own object factories.
- **Size.** −441 lines in all (+129/−570).
- **Lead checks.**
  - All 10 callers pass module-level `real` and `mock` functions, so the `useMemo` stays stable.
  - The `require('@/mock/backend')` stays inside the literal `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK` guard.
  - Emulator smoke (mock build): `/ais`, `/settings/contacts`, `/settings/devices` and `/settings/machines` PASS. The screenshots show the mock AIs (Dev-1, QA-1, Marketing AI) and devices.
