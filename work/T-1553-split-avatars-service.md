---
id: T-1553
title: "Split apps/server/src/avatars/service.ts (399 lines): the byte check (AvatarProbeError, AvatarCheck, checkAvatarBytes, toAvatarHttpError) moves to avatars/check.ts and the file read (AvatarFile, readAvatarFile) to avatars/read.ts; service.ts re-exports every name; no behaviour change"
status: merged
milestone: M5
branch: task/T-1553-split-avatars-service
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1553: Split avatars/service.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/avatars/service.ts` is 399 lines. **Follow `docs/audit/split-rules.md`:** the original path stays the barrel, so no importer changes.

### Facts (the lead read them on main, 2026-10-15)
- **Constants and schema (`:17-29`):** `AVATAR_MAX_BYTES`, `AVATAR_MIN_SIDE`, `AVATAR_MAX_SIDE`, the rate-limit constants, `avatarOwnerKindSchema`, `AvatarKind`, and `export type { AvatarRow }`.
- **Functions and types:**
  - `extensionFor` (internal, `:31`), `avatarUrlFor` (`:35`), `AvatarsServiceDeps` (`:39`);
  - `AvatarProbeError` (`:46`), `AvatarCheck` (`:54`), `checkAvatarBytes` (`:67-96`), `toAvatarHttpError` (internal, `:98-122`);
  - `checkAvatarWritePermission` (`:124`), `AvatarUploadResult` (`:172`), `uploadAvatar` (`:181`), `deleteAvatar` (`:269`);
  - `AvatarFile` (`:317`), `readAvatarFile` (`:323-378`), `avatarIdsByOwner` (`:380`).

### Steps
1. **New `apps/server/src/avatars/check.ts`:** move `AvatarProbeError`, `AvatarCheck`, `checkAvatarBytes` and `toAvatarHttpError` unchanged, exporting `toAvatarHttpError` for `service.ts`. It may import the size constants from `./service` (type-free values) only if that creates no load-time use. Otherwise move the constants it needs into `check.ts` and re-export them from `service.ts`.
2. **New `apps/server/src/avatars/read.ts`:** move `AvatarFile` and `readAvatarFile` unchanged.
3. **`service.ts`** re-exports every name it exported before, with the same kinds, and keeps the rest. Avoid a runtime cycle: the new files must not call into `service.ts` at module load.
4. **No behaviour change.** The avatar tests (`apps/server/src/avatars/*.test.ts`) must pass.

### Allowed files
- `apps/server/src/avatars/service.ts`
- `apps/server/src/avatars/check.ts` (new)
- `apps/server/src/avatars/read.ts` (new)
- `work/T-1553-split-avatars-service.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of each file;
  - the export list of `service.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/avatars/service.ts` into three files; `service.ts` stays the barrel, so no importer changes.

- **`apps/server/src/avatars/check.ts` (new, 84 lines):** `AvatarProbeError`, `AvatarCheck`, `checkAvatarBytes` and `toAvatarHttpError` moved unchanged. `toAvatarHttpError` is exported here (it was internal before) so `service.ts` can call it without re-exporting it. The three size constants `AVATAR_MAX_BYTES`, `AVATAR_MIN_SIDE`, `AVATAR_MAX_SIDE` moved here with them (see deviation below).
- **`apps/server/src/avatars/read.ts` (new, 69 lines):** `AvatarFile` and `readAvatarFile` moved unchanged.
- **`apps/server/src/avatars/service.ts` (399 -> 269 lines):** keeps the rate-limit constants, `avatarOwnerKindSchema`, `AvatarKind`, `avatarUrlFor`, `AvatarsServiceDeps`, `checkAvatarWritePermission`, `AvatarUploadResult`, `uploadAvatar`, `deleteAvatar`, `avatarIdsByOwner`, and re-exports every name it exported before.

No importer inside or outside the Avatars module was edited. `apps/server/src/avatars/api.ts` still imports `AVATAR_MAX_BYTES`, `readAvatarFile`, etc. from `./service` and compiles.

**Deviation (planned, allowed by step 1):** the spec says `check.ts` may import the size constants from `./service` "only if that creates no load-time use", otherwise move them into `check.ts` and re-export them from `service.ts`. I moved them into `check.ts` because `service.ts` importing `./check` and `./check` importing `./service` would be a real runtime import cycle (the values are read inside function bodies, but the cycle is avoidable). `service.ts` re-exports all three, so the namespace seen by importers is identical. The only other exports `check.ts` adds are `checkAvatarBytes` (already moved) and `toAvatarHttpError` (newly exported, not re-exported by the barrel).

### Checks run

- `pnpm install`: done, 1137 packages, no error (one pre-existing `@types/react-dom` peer warning in `apps/mobile`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars/access.test.ts`: **1 passed** (1 file, 1 test), 24.5s.
- `pnpm gate` (repo root), real output:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (3.4s)
  PASS  format  (1.6s)
  PASS  lint  (1.3s)
  PASS  typecheck  (7.2s)
  PASS  effect  (1.4s)
  PASS  tests @zilar/server  (13.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

`wc -l`:
```
399  apps/server/src/avatars/service.ts   (before)
269  apps/server/src/avatars/service.ts   (after)
 84  apps/server/src/avatars/check.ts
 69  apps/server/src/avatars/read.ts
```

Export list of `service.ts`, before (`git show HEAD:...`) vs after — same names, same kinds:
```
export const AVATAR_MAX_BYTES / AVATAR_MIN_SIDE / AVATAR_MAX_SIDE   (now re-exported from ./check)
export const AVATAR_UPLOAD_RATE_LIMIT_MAX / _WINDOW_MS / AVATAR_READ_RATE_LIMIT_MAX / _WINDOW_MS
export const avatarOwnerKindSchema
export type AvatarKind
export type { AvatarRow }                                          (now re-exported from ../db/rows)
export function avatarUrlFor
export interface AvatarsServiceDeps
export type AvatarProbeError / export interface AvatarCheck        (now re-exported from ./check)
export function checkAvatarBytes                                   (now re-exported from ./check)
export async function checkAvatarWritePermission
export interface AvatarUploadResult
export async function uploadAvatar / deleteAvatar
export interface AvatarFile / export async function readAvatarFile (now re-exported from ./read)
export async function avatarIdsByOwner
```

**Effect ratchet (split-rules.md item 6):** `check.ts` imports no `effect` value and shows only plain signals, so it classifies `plain` (no marker needed). `read.ts` holds the moved `async`/`await` + `try` code with no `effect` value import, so it is `needs-effect` and carries the sanctioned first line `// effect-plain: moved unchanged from apps/server/src/avatars/service.ts (size split)`. The barrel `service.ts` still imports `effect` (`Effect`, `Schema`) as a value, so it stays `effect` exactly as on the base. The gate's `effect` step printed `PASS`.

No blocker; no other file was touched.

### Round (fix round 1)

**Findings fixed**
- **Finding 1 (must-fix): `checkAvatarBytes` dropped from the barrel.** Added `checkAvatarBytes` to the value re-export from `./check` in `apps/server/src/avatars/service.ts:19`. The barrel's export surface is now identical to `main`: 22 names, same kinds, verified programmatically before/after (`only in main: []`, `only in current: []`, `IDENTICAL: true`). No other finding was raised (must-fix=1, should-fix=0, nit=0, follow-up=0).

**Should-fix / nits / disagreements:** none.

**Tests added:** none. The finding names no test and is a compile-time export surface, not a behaviour change; the existing avatar test file and any new test file fall outside the task's Allowed files, so nothing was added or changed. The nearest existing test was re-run and passes.

**Commands run this round**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars/access.test.ts`: **1 passed** (1 file, 1 test), 6.53s.
- `pnpm gate` (repo root), real output:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/server  (9.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

**Files changed this round:** `apps/server/src/avatars/service.ts` (one line) — inside Allowed files.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one autopilot round.
- **What the lead checked:**
  - **Sizes:** `service.ts` 269, `check.ts` 84 and `read.ts` 69 lines (was 399).
  - **Exports:** `service.ts` still exports every name, with the same kinds:
    - the size constants, `checkAvatarBytes`, `AvatarCheck` and `AvatarProbeError` (re-exported from `./check`);
    - `readAvatarFile` and `AvatarFile` (from `./read`);
    - the rate-limit constants, the schema, `AvatarKind`, `AvatarRow`, `avatarUrlFor` and `AvatarsServiceDeps`;
    - `checkAvatarWritePermission`, `uploadAvatar`, `deleteAvatar` and `avatarIdsByOwner`.
  - **No cycle at load:** `read.ts` imports only a type from `./service`.
- **After the deploy,** the lead checks the avatar routes on the next live check.
