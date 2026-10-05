---
id: T-0226
title: "Phone tooling: pnpm phone:smoke can build a mock-mode app for the emulator (to see the AI screens)"
status: planned
milestone: M5
branch: task/T-0226-smoke-mock-build
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0226: Mock-mode smoke build

## Spec (written by Claude, do not edit)

### Why
Three merged phone tasks (T-0189, T-0213, T-0218: tools, routines, activity and the tool detail sheet on the AI screen) were never seen on a device: the emulator's test account has no AI. The app has a mock mode with a mock AI (`ai-dev-1`) and mock tools, but the smoke build cannot use it: `scripts/phone/install.sh` builds a release bundle (lines 46 and 50-51), and `apps/mobile/src/mock/gate.ts` (lines 7-14) ignores the `?mock=` route param outside `__DEV__` unless `EXPO_PUBLIC_ZILAR_MOCK` is baked into the bundle. So `zilar://ais/ai-dev-1?mock=1` showed "That AI no longer exists." on 2026-10-05.

### Verified facts (do not re-derive)
- `scripts/phone/smoke.sh` (67 lines): `REF` arg (line 14), `SERIAL` from `ZILAR_EMULATOR` (default `emulator-5554`, line 15), `ZILAR_ROUTES` replaces the changed-screen list (lines 28-29), calls `ZILAR_PHONE="$SERIAL" ZILAR_REF="$REF" bash "$HERE/install.sh"` (line 33), skips routes containing `[` (lines 43-45), opens each route with `am start ... -d "zilar:/${route}"` (line 47).
- `scripts/phone/install.sh` (68 lines): `SERIAL` from `ZILAR_PHONE` (default Julio's phone `10AFAT234E00746`, line 16); the two gradle builds pass `EXPO_PUBLIC_ZILAR_API_URL="$API_URL" NODE_ENV=production` (lines 46, 50-51); the JS-only path rebundles with `--rerun` (line 51); it records the built commit in `$STATE_DIR/commit` (line 62) and prints a changelog for Julio.
- `apps/mobile/src/mock/gate.ts` lines 7-14 (`mockParamAllowed`); `EXPO_PUBLIC_ZILAR_MOCK` set to a non-empty value other than `0`/`false` turns mock mode on for every mock-capable API (for example `apps/mobile/src/components/ais/use-ais-api.ts` and `use-tools-api.ts`). The mock AI id is `ai-dev-1` (`apps/mobile/src/mock/ais.ts` line 47).

### What to build
1. `install.sh`: an optional env `ZILAR_MOCK=1`. When set, pass `EXPO_PUBLIC_ZILAR_MOCK=1` to both gradle commands (next to `EXPO_PUBLIC_ZILAR_API_URL`). Safety: when `ZILAR_MOCK=1` and `SERIAL` does not start with `emulator-`, print `mock builds are for the emulator only` and exit 1 before building. A mock build must not update `$STATE_DIR/commit` (the changelog for Julio's phone stays honest); force the bundle rebuild path when the previous build's mock flag differs (store the flag in `$STATE_DIR/mock` and treat a change like a JS-only change, so the next normal build never ships a mock bundle).
2. `smoke.sh`: an optional env `ZILAR_SMOKE_MOCK=1` that passes `ZILAR_MOCK=1` to `install.sh`, and when `ZILAR_ROUTES` is not set uses the default route list `/ /ais /ais/ai-dev-1` instead of the changed screens. Print `mock build` in the `building ...` line. Update the header comment with one example: `ZILAR_SMOKE_MOCK=1 pnpm phone:smoke main`.
3. `docs/LEAD_HANDOFF.md`: one line after the `pnpm phone:smoke` mention (line 34): "`ZILAR_SMOKE_MOCK=1 pnpm phone:smoke <branch>` builds a mock-mode app (emulator only) and opens `/`, `/ais` and the mock AI `/ais/ai-dev-1`, so the AI screen's tools, routines and activity can be seen; the next normal smoke reinstalls the real app."

### Read first
`AGENTS.md`, `scripts/phone/smoke.sh`, `scripts/phone/install.sh`, `apps/mobile/src/mock/gate.ts`.

### Allowed files
`scripts/phone/smoke.sh`, `scripts/phone/install.sh`, `docs/LEAD_HANDOFF.md`, `work/T-0226-smoke-mock-build.md`.

### Checks
```bash
bash -n scripts/phone/smoke.sh && bash -n scripts/phone/install.sh
ZILAR_MOCK=1 ZILAR_PHONE=10AFAT234E00746 bash scripts/phone/install.sh; echo "exit $?"   # must print "mock builds are for the emulator only" and exit 1 (it exits before adb if you put the check first; if adb says the phone is not connected first, move the check above the adb check)
pnpm gate
```
Do not run a full build or touch the emulator: the lead runs the real smoke after review.

### Acceptance
- `ZILAR_SMOKE_MOCK=1 pnpm phone:smoke <branch>` installs a mock-mode build on the emulator and screenshots `/`, `/ais`, `/ais/ai-dev-1`.
- A mock build is refused for any serial that is not an emulator, never changes Julio's phone changelog state, and the next normal build rebundles without the mock flag.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Opening the tool detail sheet by tapping (the lead does that by hand), iOS.

---

## Report (written by the worker when done)

## Review (written by Claude)
