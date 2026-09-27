---
id: T-0011
title: Expo app scaffold in the monorepo (Expo Router, NativeWind, React Native Reusables)
status: todo
milestone: M0
branch: task/T-0011-mobile-scaffold
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0001, T-0012]
estimate: 1 day
---

# T-0011: Expo app scaffold

## Spec (written by Claude, do not edit)

### Goal
Add the mobile app `@galena/mobile` to the monorepo: an Expo app that shows the same placeholder screen as the web app. It proves three things:
- Expo works inside our pnpm workspace.
- Metro can import `@galena/protocol` from source.
- The styling stack (NativeWind + React Native Reusables) is in place for real screens later.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §17.2 Mobile: React Native + Expo
- `apps/web/src/App.tsx`: the screen to mirror
- Official docs, current versions:
  - Expo "Work with monorepos" guide (the pnpm section)
  - Expo Router installation
  - React Native Reusables installation for Expo, and the NativeWind docs it links to

### Allowed files
- `apps/mobile/**`: new app. Put its own docs in `apps/mobile/README.md`.
- `pnpm-workspace.yaml`:
  - add `overrides:` with `'@types/node': '^24'` (follow-up from the T-0012 review)
  - add any Expo-required setting **except** changing `nodeLinker` (see below)
- `pnpm-lock.yaml`
- `.gitignore`: only the Expo entries the Expo docs recommend, e.g. `expo-env.d.ts`
- Root `oxlint`/`prettier` ignore files, only if generated Expo files break lint or format. Explain in the Report.

**Not allowed:**
- root `package.json`
- `README.md`
- `.github/**`
- `infra/**`
- `packages/devtools/**`

Other workers are editing those in parallel.

### Decisions (follow them)
| Thing | Choice |
|---|---|
| Expo SDK | **57** (latest stable, React Native 0.86). **Not** the SDK 58 beta. |
| Navigation | Expo Router, with a single route: `app/_layout.tsx` + `app/index.tsx` |
| Styling | NativeWind + React Native Reusables, using the versions React Native Reusables currently documents for Expo SDK 57. If its docs offer NativeWind or Uniwind, use **NativeWind**. |
| Package | `@galena/mobile`, `private: true`. Depends on `@galena/protocol` as `workspace:*` |
| Native folders | `ios/` and `android/` stay generated and git-ignored (Expo prebuild / CNG). **Never commit them.** |
| Linker | Keep pnpm's default isolated `node_modules`. If Expo truly cannot work without `nodeLinker: hoisted` (or another repo-wide linker change), **stop, set `status: blocked`**, and explain in the Report. Don't change it yourself. |

### Steps and hints
1. Create the app in `apps/mobile`. `npx create-expo-app@latest` with the default or a TypeScript template is fine, then trim it to one screen and remove the example tabs, assets and components you don't use. Rename the package to `@galena/mobile`.
2. **App config:**
   - name `Galena`, slug `galena`, scheme `galena`
   - iOS bundle identifier and Android package `com.julioferrero.galena`
   - `userInterfaceStyle: automatic`
3. **Screen `app/index.tsx`** mirrors the web page:
   - **Galena** as a heading
   - "People and AIs, together." as a subtitle
   - `protocol v{protocolVersion}`, imported from `@galena/protocol`
   - centered, following the system light/dark scheme, styled with NativeWind classes
   - use at least one React Native Reusables component (e.g. `Text`)
4. **Monorepo:** follow Expo's pnpm monorepo guide so Metro resolves `@galena/protocol` (a TypeScript source package; see its `exports`).
5. **Add `overrides: { '@types/node': '^24' }`** to `pnpm-workspace.yaml`. Confirm with `pnpm why -r @types/node` that only 24.x remains, and paste the output in the Report.
6. **Scripts in `apps/mobile/package.json`:**
   - `start` (`expo start`)
   - `ios` (`expo run:ios`)
   - `android` (`expo run:android`)
   - `typecheck` (`tsc --noEmit`)
   - `test` (`vitest run`)
   - `build` (`expo export --platform ios --platform android --output-dir dist`). This bundles the JavaScript only, with no native build, and runs in CI through `turbo build`.
7. **One Vitest test** for a small pure helper you add in `src/lib/` (e.g. `protocolLabel(version)` returning `protocol v0.1.0`). The screen uses it. No React Native component tests in this task.
8. **`apps/mobile/README.md`:** how to run it (`pnpm --filter @galena/mobile start`, the iOS simulator, a dev build on a phone), and the notes about generated native folders.
9. **Try an iOS simulator build** with `pnpm --filter @galena/mobile ios`. Report what happened: success, a screenshot path if you can take one with `xcrun simctl io booted screenshot`, or the exact error, e.g. missing CocoaPods or no simulator. **A failure here does not block the task,** but installing system software (brew, CocoaPods, Xcode components) is **not allowed**. Report what's missing instead.

### Acceptance criteria
- [ ] `pnpm install` works from the repo root, with no `nodeLinker` change.
- [ ] `pnpm --filter @galena/mobile typecheck`, `test` and `build` (expo export) pass.
- [ ] The root `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` and `pnpm build` still pass for the whole repo.
- [ ] `npx expo-doctor` inside `apps/mobile` passes, or its warnings are listed and explained in the Report.
- [ ] The exported bundle includes the `@galena/protocol` code, proving Metro resolves the workspace package. Explain how you checked.
- [ ] `pnpm why -r @types/node` shows only 24.x.
- [ ] No `ios/` or `android/` folders are committed.
- [ ] The iOS simulator attempt result is reported.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd apps/mobile && npx expo-doctor
```

### Out of scope
- Real screens, navigation structure, auth, XMPP, push, voice (later tasks).
- EAS configuration and store builds.
- Installing system tools.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Versions installed (Expo SDK, React Native, Expo Router, NativeWind, React Native Reusables, Tailwind)
-

### Commands run and real results
-

### iOS simulator attempt
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
