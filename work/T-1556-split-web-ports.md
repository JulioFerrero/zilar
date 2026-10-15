---
id: T-1556
title: "Split apps/web/src/store/effects/ports.ts (400 lines, the limit): the ApiClient and StorageLike interfaces move to store/effects/portTypes.ts; ports.ts re-exports both types and keeps the Ports service, layers and test ports; no behaviour change"
status: merged
milestone: M5
branch: task/T-1556-split-web-ports
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1556: Split web ports.ts

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/store/effects/ports.ts` is exactly 400 lines. Every new API call the web store makes adds a line to its `ApiClient` interface. **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **Interfaces:**
  - `ApiClient` (`:118-199`, one method per API call);
  - `StorageLike` (`:201-205`);
  - `RealStoreDeps` (`:208`), `PortsShape` (`:229`).
- **Values:**
  - the `Ports` service (`:258`), `resolvePorts` (`:313`), `portsLayer` (`:342`) and `PortsLive` (`:345`);
  - `inertApi` and `inert` (internal, `:347-357`);
  - `testPorts` (`:359`), `PortsTest` (`:394`) and `readPorts` (`:398`).
- **The imports at the top** (`:1-117`) bring in the types the interfaces use.

### Steps
1. **New `apps/web/src/store/effects/portTypes.ts`:** move `ApiClient` and `StorageLike` unchanged, with the type imports they need.
2. **`ports.ts`:** `export type { ApiClient, StorageLike } from './portTypes'`, plus a type import for its own use. Remove the imports only the moved interfaces used. Keep everything else.
3. **No behaviour change**, and no importer changes.

### Allowed files
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/portTypes.ts` (new)
- `work/T-1556-split-web-ports.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `ports.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did
Split `apps/web/src/store/effects/ports.ts` (400 lines on base).

- New `apps/web/src/store/effects/portTypes.ts`: `ApiClient` and `StorageLike` moved unchanged, with the type imports they use (all 31 `type` imports from `@/lib/api`).
- `apps/web/src/store/effects/ports.ts`:
  - removed the 31 `type` entries from the `@/lib/api` import, leaving the value imports (`getMe`, `getChats`, … `unpinMessage as unpinMessageRequest`);
  - added `import type { ApiClient, StorageLike } from './portTypes';` for its own use (in `RealStoreDeps`, `PortsShape`, `realApi`, `inertApi`);
  - added `export type { ApiClient, StorageLike } from './portTypes';`;
  - kept the `Ports` service, `resolvePorts`, `portsLayer`, `PortsLive`, `inertApi`, `inert`, `testPorts`, `PortsTest`, `readPorts` and the header comment unchanged.
- No importer changed (`portAdapters.ts` and every other file still imports from `./ports`).

### Checks run
- `pnpm install` — Done in 27.4s using pnpm v10.32.1.
- `pnpm gate` (repo root) — exit 0, summary: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `size: every changed source file is within 400 lines`, `GATE PASS`.
- No single test file was run separately; the gate's `tests @zilar/web` step covered the nearest kept tests.

### Notes for the lead
- `wc -l`: old `ports.ts` = 400; new `ports.ts` = 283; new `portTypes.ts` = 126.
- Export list diff (`grep -E "^export"` on old `ports.ts` vs the barrel plus `portTypes.ts`): identical names and kinds. The two interfaces now appear as `portTypes.ts`: `export interface ApiClient {`, `export interface StorageLike {`; `ports.ts`: `export type { ApiClient, StorageLike } from './portTypes';`. All other exports (`RealStoreDeps`, `PortsShape`, `Ports`, `resolvePorts`, `portsLayer`, `PortsLive`, `testPorts`, `PortsTest`, `readPorts`) are unchanged.
- Effect ratchet: `portTypes.ts` holds only type imports and interfaces, so it classifies `plain`; no `// effect-plain:` marker was added. The gate printed `PASS effect`.
- Deviations from the spec: none.
- Files changed: `apps/web/src/store/effects/portTypes.ts` (new), `apps/web/src/store/effects/ports.ts`, `work/T-1556-split-web-ports.md`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - `ports.ts` drops from 400 to 283 lines, and `portTypes.ts` is 126;
  - the `^export` lines differ from main only in that `ApiClient` and `StorageLike` are now `export type { … } from './portTypes'`;
  - every other export is unchanged, and no importer changed.
