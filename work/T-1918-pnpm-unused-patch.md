---
id: T-1918
title: "URGENT deploy fix 2: allow the expo-share-intent patch to be unused (pnpm allowUnusedPatches), so the server image's `pnpm --filter @zilar/server deploy --prod` stops failing with ERR_PNPM_UNUSED_PATCH"
status: merged
milestone: M5
branch: task/T-1918-pnpm-unused-patch
model: auto
effort: default
depends_on: [T-1917]
estimate: 15 min
---

# T-1918: The server deploy accepts the phone-only patch

## Spec (written by Claude, do not edit)

### Why
After T-1917, the image install step works. But the **Production images** run for `5e0247a38` fails in zilar-server at:
```
RUN pnpm --filter @zilar/server deploy --prod --legacy /opt/zilar-server
ERR_PNPM_UNUSED_PATCH  The following patches were not used: expo-share-intent@8.0.1
```
The patch (T-1908) is for the phone app only; the server's dependency set doesn't contain expo-share-intent. **Nothing deploys until this passes.**

### Facts (read by the lead on 2026-10-17)
- **The patch entry:** `pnpm-workspace.yaml` has `patchedDependencies: expo-share-intent@8.0.1: patches/expo-share-intent@8.0.1.patch` (added by T-1908).
- **pnpm** is 10.32.1 (`pnpm --version`).

### Steps
1. In `pnpm-workspace.yaml`, add the top-level setting `allowUnusedPatches: true`, with a comment saying the patch is phone-only and that filtered deploys (the server image) don't install it. If pnpm 10.32 names this setting differently, use the name it accepts and say so in your Report.
2. **Local check, no Docker:** from the worktree run
   ```
   pnpm --filter @zilar/server deploy --prod --legacy /tmp/zilar-T-1918-deploy-check
   ```
   It must finish without `ERR_PNPM_UNUSED_PATCH`. Paste the last lines in your Report. Use a new path if it exists, and don't `rm -rf` anything.
3. Run `pnpm install` (the lockfile must stay valid), then `pnpm gate`.

### Allowed files
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `work/T-1918-pnpm-unused-patch.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The local `pnpm --filter @zilar/server deploy --prod --legacy` succeeds.**
- **The phone still gets the patch:** `pnpm install` applies it, and the lockfile keeps the `patch_hash`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added the top-level setting `allowUnusedPatches: true` to `pnpm-workspace.yaml`, with a short comment (T-1918): the `expo-share-intent` patch is phone-only and filtered deploys (the server image) don't install it. pnpm 10.32.1 accepts this exact name.
- Ran `pnpm install`: it completed, applied the patch, and left `pnpm-lock.yaml` untouched.
- Ran the local deploy check twice (new paths, nothing deleted): `/tmp/zilar-T-1918-deploy-check-1` and `/tmp/zilar-T-1918-deploy-check-2`. Both exited 0 with no `ERR_PNPM_UNUSED_PATCH`.
- Verified the phone still gets the patch: `pnpm install` applied it, the lockfile still carries `patch_hash=20ce0f19d68e81cf8c75bb2d1aa9039f2ff638cc646c48bc35703f4ba9edce32` for `expo-share-intent@8.0.1` (lines 208 and 10467 of `pnpm-lock.yaml`), and in the installed module `node_modules/.pnpm/expo-share-intent@8.0.1_patch_hash=.../ExpoShareIntentModule.kt` the patched-out `android.os.Environment` import is gone (grep count 0).
- Files changed: `pnpm-workspace.yaml`, `work/T-1918-pnpm-unused-patch.md`. The lockfile did not change.

### Checks run
- `pnpm install` (pnpm 10.32.1): exit 0, "Done in 12.7s using pnpm v10.32.1". One pre-existing peer warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm --filter @zilar/server deploy --prod --legacy /tmp/zilar-T-1918-deploy-check-2`: exit 0. Last lines:
  ```
  └─┬ @zilar/client-core 0.1.0
    ├── ✕ unmet peer @effect/atom-react@catalog:: found 4.0.4
    └── ✕ unmet peer effect@catalog:: found 4.0.4
  .                                        | +231 +++++++++++++++++++++++
  ```
  No `ERR_PNPM_UNUSED_PATCH`; the peer warnings were already there and do not fail the deploy.
- `pnpm gate`: exit 0, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change is pnpm configuration only, no source changed.

### Notes for the lead
- No deviations from the spec. `allowUnusedPatches` is the name pnpm 10.32.1 accepts, so no fallback name was needed.
- The setting only silences the unused-patch error for dependency sets that don't contain `expo-share-intent`; the lockfile hash and the installed phone package prove the patch is still applied where it is used.
- The deploy check directories `/tmp/zilar-T-1918-deploy-check-1` and `-2` were left in place (not deleted).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `e41ec40fb`.
- **The fix:** `allowUnusedPatches: true` in `pnpm-workspace.yaml`, with a comment. The lockfile is unchanged and keeps the `patch_hash`.
- **Verified locally:** `pnpm --filter @zilar/server deploy --prod --legacy` exits 0 with no `ERR_PNPM_UNUSED_PATCH`.
- **The real proof** is the next "Production images" run.
