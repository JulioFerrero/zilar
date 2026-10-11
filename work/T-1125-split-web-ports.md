---
id: T-1125
title: "Size split: apps/web/src/store/effects/ports.ts (427) — the browser default adapters move unchanged to store/effects/portAdapters.ts"
status: merged
milestone: M5
branch: task/T-1125-split-web-ports
model: auto
effort: default
depends_on: [T-1122]
estimate: 0.1 day
---

# T-1125: Split web `ports.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` #103. `apps/web/src/store/effects/ports.ts` has 427 lines (read by the lead).

**The parts:**
- **The interfaces and the tag, `:101-268`:** `ApiClient`, `StorageLike`, `RealStoreDeps`, `PortsShape`, `Ports`, and whatever sits between them and `:268`.
- **The browser defaults and port adapters, `:269-348`:** `defaultStorage`, `defaultVisible`, `defaultOnFocus`, `defaultGoToLogin`, `objectUrlFor`, `bytesFromAttachmentPort`, `voiceFromPort`.
- **The rest:** `resolvePorts` (`:349`), `portsLayer`, `PortsLive`, `inertApi`, `inert`, `testPorts`, `PortsTest` and `readPorts` (`:371-427`).

### What to build
1. **A new `apps/web/src/store/effects/portAdapters.ts`** holds `:269-348`, **moved byte-for-byte**, exported where `ports.ts` uses them.
   - It may import types from `./ports` as `import type` only, so there is no runtime cycle.
2. **`ports.ts`** keeps everything else and imports the adapters. Every name it exports today stays exported.
3. **No behaviour change.**
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **Tests:** run the web tests that import `effects/ports` (`grep -rln "effects/ports\|'./ports'" apps/web/src | grep test`), if there are any, and paste the results.

### Read first
`AGENTS.md`, and `apps/web/src/store/effects/ports.ts`.

### Allowed files
`apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/portAdapters.ts`, `work/T-1125-split-web-ports.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

### What I did
Split `apps/web/src/store/effects/ports.ts` (427 lines) into two files, no behaviour change.

- New `apps/web/src/store/effects/portAdapters.ts` (100 lines) holds the browser
  defaults and the port adapters, moved body-for-body unchanged: `defaultStorage`,
  `defaultVisible`, `defaultOnFocus`, `realRows`, `webFlags`, `liveNotifications`,
  `defaultGoToLogin`, `objectUrlFor`, `bytesFromAttachmentPort`, `voiceFromPort`.
  The declarations are now `export`ed where `ports.ts` uses them; `objectUrlFor`
  stays private because only `bytesFromAttachmentPort` uses it. It imports types
  from `./ports` with `import type` only (`StorageLike`), so there is no runtime
  cycle; it also imports `summariesFor`, `fromPromise`, `cleanFilename`, `updateAppBadge`,
  `totalBadgeUnread`, `dismissChatNotifications` and the port types.
- `apps/web/src/store/effects/ports.ts` (354 lines) keeps everything else
  (`ApiClient`, `StorageLike`, `RealStoreDeps`, `PortsShape`, `Ports`, `realApi`,
  `resolvePorts`, `portsLayer`, `PortsLive`, `inertApi`, `inert`, `testPorts`,
  `PortsTest`, `readPorts`) and imports the adapters. Every name it exported
  before is still exported, so `realStore.ts` and the other importers are unaffected.

### Files changed
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/portAdapters.ts` (new)
- `work/T-1125-split-web-ports.md` (this report)

### Line counts (`wc -l`)
```
     354 apps/web/src/store/effects/ports.ts
     100 apps/web/src/store/effects/portAdapters.ts
```
Both are at most 400.

### Commands and real results
- `pnpm install` — succeeded (pnpm v10.32.1).
- `grep -rln "effects/ports\|'./ports'" apps/web/src | grep test` — no matches, so
  no test file imports `effects/ports`. Ran the nearest effects test instead:
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/sendFailure.test.ts`
  — `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.3s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/web  (6.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
- The spec names `:269-348` and lists only the browser defaults and the port
  adapters. That range also contains `realRows`, `webFlags` and `liveNotifications`,
  which sit between `defaultOnFocus` and `defaultGoToLogin`. Since they are port
  adapters and the range is authoritative, I moved them too.
- I moved lines `:269-347` and left the `resolvePorts` doc comment (line 348) with
  `resolvePorts` in `ports.ts`, so `portAdapters.ts` ends at `voiceFromPort` instead
  of ending with a comment about a function it does not contain.
- The moved bodies are byte-for-byte unchanged; the only edits are adding `export`
  to the declarations `ports.ts` reads (required by the spec).

### Open questions / blocked
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (the Report's line count is off by one).**
- **The split:** web `store/effects/ports.ts` goes from 427 to 355 lines. The browser defaults, port adapters and the `realRows`/`webFlags`/`liveNotifications` constants move to `store/effects/portAdapters.ts` (100), which imports only the `StorageLike` type from `./ports`.
- **The lead's line check:** the removed lines missing from the new file are only the declarations that gained `export` and one import line.
- **The gate passed.**
