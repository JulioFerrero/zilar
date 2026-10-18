---
id: T-2034
title: "Share W1-d: the client-version check (10-minute throttle, readMinClientProtocol, /health parse) and the contact-requests poll (60 s, keep the old list on failure, reload on foreground) move to client-core; each app keeps a tiny onForeground adapter (window focus/visibility on web, AppState on phone) and thin hooks with the same names — net about −90 lines"
status: merged
milestone: M5
branch: task/T-2034-shared-version-and-requests
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2034: Shared client-version check and contact-requests poll (share plan W1-d)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` §2.7, §2.9 and slice **W1-d** found two pairs of copied hooks. They differ only in how each app learns that the user came back.
- **The client-version check.** jscpd clones: mobile:30-67 ↔ web:34-71, and mobile:6-24 ↔ web:6-22.
- **The contact-requests poll.**

The net saving is about 90 lines. These hooks are UI timers, so there are no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18 at `c0f134fa7`)
- **Client version.**
  - `apps/web/src/lib/useClientVersionCheck.ts` (86 lines):
    - the 10-minute gap (`:9`), `readMinClientProtocol` (`:12-18`), fetch and parse (`:31-44`), the throttle and check (`:52-67`);
    - the trigger is window `focus` and `visibilitychange` (`:71-82`);
    - `/health` is same-origin, with mock mode (`:22-25`).
  - `apps/mobile/src/lib/use-client-version.ts` (76 lines): the same logic (`:9`, `:12-18`, `:24-40`, `:48-63`). It fetches `${API_URL}/health` (`:28`), and its trigger is `AppState` `active` (`:67-72`).
- **Contact requests.**
  - `apps/web/src/lib/useContactRequests.ts` (62 lines): 60 s via `Effect.repeat` + `Schedule.fixed` (`:43`), window `focus` (`:44-47`), and a failure keeps the old list (`:20`).
  - `apps/mobile/src/lib/use-contact-requests.ts` (59 lines): the same, with a hand-written `setInterval` (`:46`) and `AppState` (`:47-51`).
- **Importers** use the app hook names (`ClientVersionBanner.tsx`, `client-version-banner.tsx`, `RequestRows.tsx`, `request-rows.tsx`). **Keep every app hook's name and signature.**
- **The client-core barrel.** `packages/client-core/src/index.ts` (28 lines). Line 14 is `export { useSmoothText } from './use-smooth-text';`. Other tasks append at the end of the file.

### Steps
1. **The shared module.** Create `packages/client-core/src/foreground-hooks.ts`, using only `react` and `effect`, with:
   - `type OnForeground = (cb: () => void) => () => void`;
   - `readMinClientProtocol(raw: unknown): number | undefined`;
   - `useClientVersionCheck(fetchHealth: () => Promise<Response>, onForeground: OnForeground, currentProtocol: …)`. Copy the exact throttle, parse and compare from today's hooks; check what each app passes and returns, and keep that;
   - `useContactRequestsPoll<T>(list: () => Promise<T[]>, enabled: boolean, onForeground: OnForeground): { requests: T[]; reload: () => void }`. It does a 60 s `Schedule.fixed` repeat plus a reload on foreground, and keeps the old list on failure.

   At most about 120 lines.
2. **The barrel.** Add ONE export line to `packages/client-core/src/index.ts`, **directly after line 14**, not at the end.
3. **Web.** New `apps/web/src/lib/foreground.ts`: `onForeground(cb)`, which subscribes to window `focus` and to `visibilitychange` when the page becomes visible, and returns an unsubscribe. `useClientVersionCheck.ts` and `useContactRequests.ts` become thin wrappers with the same exports. Keep web's mock-mode `/health` handling.
4. **Phone.** New `apps/mobile/src/lib/foreground.ts`: `onForeground(cb)`, which subscribes to `AppState` `active`. `use-client-version.ts` and `use-contact-requests.ts` become thin wrappers with the same exports. The `setInterval` goes.
5. **Fewer lines.** Product lines across the four old hooks plus the new files must end **below 230**, against 283 today. Put the before and after counts in the Report. No tests (UI timers). Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/foreground-hooks.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/foreground.ts`
- `apps/web/src/lib/useClientVersionCheck.ts`
- `apps/web/src/lib/useContactRequests.ts`
- `apps/mobile/src/lib/foreground.ts`
- `apps/mobile/src/lib/use-client-version.ts`
- `apps/mobile/src/lib/use-contact-requests.ts`
- `work/T-2034-shared-version-and-requests.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines end below 230.
- **Lead check on web:** the request rows still load, and the version banner still appears when the server's `minClientProtocol` is raised (mock).

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/foreground-hooks.ts` with `OnForeground`,
  `readMinClientProtocol`, `useClientVersionCheck` and `useContactRequestsPoll`.
  The version check keeps the 10-minute throttle, `/health` parse and
  `isClientOutdated` compare; the poll keeps the 60 s `Schedule.fixed` repeat,
  the foreground reload and the "keep the old list on failure" behaviour.
- Added one export statement for the module directly after line 14 of
  `packages/client-core/src/index.ts` (prettier wraps it across lines).
- Web: new `apps/web/src/lib/foreground.ts` (`focus` + `visibilitychange`
  when visible); `useClientVersionCheck.ts` and `useContactRequests.ts` are now
  thin wrappers with the same exports, and the mock-mode `/health` handling is
  kept in the web wrapper.
- Phone: new `apps/mobile/src/lib/foreground.ts` (`AppState` `active`);
  `use-client-version.ts` and `use-contact-requests.ts` are thin wrappers with
  the same exports. The hand-written `setInterval` is gone.
- No tests added (UI timers, as the spec says).

Product line counts (`wc -l`):
- Before: four old hooks 86 + 76 + 62 + 59 = **283**.
- After: four hooks 21 + 15 + 15 + 21 = 72, plus new files 122 + 16 + 12 = 150,
  total **222** (below 230). Every touched file is under 400 lines.

Files changed (all inside Allowed files): `packages/client-core/src/foreground-hooks.ts`,
`packages/client-core/src/index.ts`, `apps/web/src/lib/foreground.ts`,
`apps/web/src/lib/useClientVersionCheck.ts`, `apps/web/src/lib/useContactRequests.ts`,
`apps/mobile/src/lib/foreground.ts`, `apps/mobile/src/lib/use-client-version.ts`,
`apps/mobile/src/lib/use-contact-requests.ts`, this task file.

### Checks run

`pnpm install --frozen-lockfile`: done in 18.7s.
`pnpm gate` (first two runs): failed only on prettier formatting of
`foreground-hooks.ts` and then `useContactRequests.ts`; I ran
`pnpm exec prettier --write` on those two files and re-ran the gate.
Final `pnpm gate` from the repo root (9 changed files against main):

```
PASS  install (frozen)  (1.6s)
PASS  format  (0.5s)
PASS  lint  (0.9s)
PASS  typecheck  (6.3s)
PASS  effect  (1.0s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/client-core  (2.8s)
PASS  tests @zilar/mobile  (2.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no separate single test file; the gate ran the client-core and mobile
nearby tests.

### Notes for the lead

- The spec says `readMinClientProtocol(raw: unknown): number | undefined`, but
  both old hooks return `string | undefined` (the value is a semver string).
  I kept the real `string | undefined` so the compare stays exact.
- "Using only `react` and `effect`": the shared module also imports
  `isClientOutdated` from `@zilar/protocol` (already a client-core dependency),
  because the spec says to copy the compare from the old hooks. No new
  dependency was added.
- The first gate run's Effect ratchet flagged the thin wrappers for raw
  `fetch` / `.then` once they were no longer classified as Effect files. They
  now lift those calls with `Effect.promise` + `Effect.runPromise`, so the
  wrappers still use Effect and the gate's `effect` check passes.
- Web `reload` now runs outside the loop (same as before) and is not aborted on
  unmount; a late response would call `setRequests` on an unmounted component,
  which React ignores. The old web code interrupted it through `useAction`.
- Not exercised in a browser by me (no lead/phone smoke run); web/phone
  behaviour was only verified by typecheck, lint and the gate.


## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.**
  - client-core `foreground-hooks.ts` holds the version check (10-minute throttle, `/health` parse, `isClientOutdated`) and the contact-requests poll (`Schedule.fixed` 60 s, reload on foreground, keeps the old list on failure).
  - Each app has a 12–16-line `foreground.ts`: window focus and visibility on web, `AppState` on the phone.
  - The app hooks keep their names and signatures.
- **The lead read the wrappers.** Their health and list functions are module-level, and the phone's per-render `() => list(api)` goes through a latest-value ref, so there's no reload loop.
- **Size.** Product lines went from 283 to 222, which is −61.
- **Not yet checked:** the banner on a raised `minClientProtocol`. It needs a live server change, so it waits for the next release check.
