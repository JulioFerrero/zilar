---
id: T-0011
title: Expo app scaffold in the monorepo (Expo Router, NativeWind, React Native Reusables)
status: merged
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

1. **Scaffolded the app.** `npx create-expo-app@latest apps/mobile --template default --no-install --no-agents-md`
   (Expo SDK 57, Expo Router). Removed the example tab screen, components, hooks, constants,
   `scripts/reset-project.js`, `.vscode`, its `LICENSE`, and the unused example assets. Renamed the
   package to `@galena/mobile` (`private: true`), added `dev/build/typecheck/test` scripts, and kept
   the template's `src/` layout (`src/app`, `src/components`, `src/lib`).
2. **App config** (`app.json`): name `Galena`, slug `galena`, scheme `galena`,
   `userInterfaceStyle: automatic`, iOS `bundleIdentifier` and Android `package`
   `com.julioferrero.galena`, plus `web.bundler: metro`.
3. **Styling stack.** NativeWind **4.2.7** (the version whose docs add Expo SDK 57 support, Tailwind 3
   line) with the React Native Reusables **NativeWind** setup:
   - `babel.config.js` (`babel-preset-expo` with `jsxImportSource: 'nativewind'` + `nativewind/babel`).
   - `metro.config.js` (`withNativeWind(config, { input: './src/global.css', inlineRem: 16 })`).
   - `tailwind.config.js` (RNR theme extension, `darkMode: 'class'`, `nativewind/preset`,
     `tailwindcss-animate`) and `src/global.css` (Tailwind directives + RNR CSS variables for light/dark).
   - RNR `Text` component copied into `src/components/ui/text.tsx` (registry `nativewind` variant),
     with `src/lib/utils.ts` (`cn`) and `src/lib/theme.ts` (`NAV_THEME`); `components.json` added so
     `react-native-reusables add` works later; `PortalHost` mounted in the root layout.
   - `nativewind-env.d.ts` for the NativeWind types.
4. **Screen** `src/app/index.tsx` mirrors `apps/web/src/App.tsx`: **Galena** heading, "People and AIs,
   together." subtitle, and `protocol v{protocolVersion}` imported from `@galena/protocol`, centered,
   using RNR `Text` with NativeWind classes (`bg-background`, `text-foreground`,
   `text-muted-foreground`). Root layout wraps a single-route `Stack` (header hidden) in RNR's
   `ThemeProvider` + `StatusBar`.
5. **Monorepo wiring.** Expo's automatic Metro monorepo support (SDK 54+ supports pnpm isolated
   `node_modules`) resolves `@galena/protocol` from source; no `watchFolders`/`nodeModulesPaths`
   overrides, and **`nodeLinker` was not changed**.
6. **`pnpm-workspace.yaml`:** added `overrides: { '@types/node': '^24' }`.
7. **Helper + test:** `src/lib/protocol.ts` (`protocolLabel(version)`) with `src/lib/protocol.test.ts`
   (Vitest); the screen uses the helper.
8. **`.gitignore`:** added `expo-env.d.ts` to the root Expo section. `ios/` and `android/` stay ignored
   (generated by prebuild) and were not committed.
9. **`apps/mobile/README.md`:** how to run (`pnpm --filter @galena/mobile start`, iOS simulator, dev
   build on a phone), the scripts, and the generated-native-folders note.

### Files changed

- `apps/mobile/**` (new): `.gitignore`, `README.md`, `app.json`, `babel.config.js`,
  `metro.config.js`, `tailwind.config.js`, `components.json`, `nativewind-env.d.ts`,
  `package.json`, `tsconfig.json`, `assets/images/*` (icon/splash/adaptive/favicon),
  `src/app/_layout.tsx`, `src/app/index.tsx`, `src/components/ui/text.tsx`, `src/global.css`,
  `src/lib/{protocol.ts,protocol.test.ts,theme.ts,utils.ts}`.
- `pnpm-workspace.yaml`: added `overrides: { '@types/node': '^24' }`.
- `pnpm-lock.yaml`: re-resolved with the mobile workspace (single `@types/node@24.19.0`).
- `.gitignore`: added `expo-env.d.ts` under the expo section.
- `work/T-0011-mobile-scaffold.md`: status + this Report.

### Versions installed (Expo SDK, React Native, Expo Router, NativeWind, React Native Reusables, Tailwind)

- Expo SDK **57** (`expo` 57.0.25), React Native **0.86.3**, Expo Router **57.0.23**.
- NativeWind **4.2.7** with `react-native-css-interop` **0.2.7**; Tailwind CSS **3.4.19** (`^3.4.17`),
  `tailwindcss-animate` 1.0.7.
- React/React DOM **19.2.3**; Reanimated **4.5.1**, `react-native-worklets` 0.10.1,
  `react-native-safe-area-context` 5.7.0, `react-native-screens` 4.26.2;
  `babel-preset-expo` 57.0.13; TypeScript 6.0.3.
- React Native Reusables has **no npm package**: the `Text` component was copied from its `nativewind`
  registry (source `packages/registry/src/nativewind/components/ui/text.tsx`, registry JSON
  `apps/docs/public/r/nativewind/text.json`) plus the minimal-template `lib/theme.ts`, as of
  2026-09-27. Supporting deps: `@rn-primitives/slot` 1.5.2, `@rn-primitives/portal` 1.5.3,
  `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0.

### Commands run and real results

- `pnpm install` → PASS ("Lockfile is up to date", "Already up to date", "Done in 595ms").
- `pnpm format:check` → PASS ("All matched files use Prettier code style!").
- `pnpm lint` → PASS ("Found 0 warnings and 0 errors", 23 files, 127 rules).
- `pnpm typecheck` → PASS (turbo "4 successful, 4 total"; mobile runs `tsc --noEmit`).
- `pnpm test` → PASS (turbo "4 successful, 4 total": protocol 6, server 2, web 3, **mobile 1**).
- `pnpm build` → PASS (turbo "2 successful, 2 total"; mobile `expo export` wrote iOS and Android
  Hermes bundles, `dist`).
- `cd apps/mobile && npx expo-doctor@latest` → PASS ("21/21 checks passed. No issues detected!").
- `pnpm why -r @types/node` → outputs `@types/node@24.19.0` and ends with
  "Found 1 version of @types/node". Only 24.x remains.
- **Metro resolves the workspace package:** after `expo export` I grepped both Hermes bundles for
  string literals that only exist in `packages/protocol/src/handoff.ts`:
  `LC_ALL=C grep -a -o -e 'return_format' -e 'context_summary' dist/_expo/static/js/{ios,android}/*.hbc`
  → each bundle contains `context_summary` and `return_format`. That code is not imported anywhere in
  the app directly, so it can only come from bundling `@galena/protocol` (imported via `protocolVersion`).
- `git status`: only `.gitignore`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `work/T-0011-mobile-scaffold.md` and the new `apps/mobile/`. `git add -n apps/mobile` stages no
  `ios/`, `android/`, `expo-env.d.ts`, `dist/` or `.expo/` (all ignored).

### iOS simulator attempt

**Succeeded.** The machine has Xcode 26.6, CocoaPods 1.17.0 and iOS 26.5 simulators (iPhone 17 Pro),
so no system software had to be installed.

- `pnpm --filter @galena/mobile ios` (`expo run:ios`) ran prebuild + `pod install` + Xcode build and
  installed the app (`xcrun simctl get_app_container booted com.julioferrero.galena` returned a
  container; `Galena.app` exists under DerivedData). The command **timed out at 40 min only because
  `expo run:ios` leaves the Metro dev server running after launching** — the build and install had
  already finished. I then started Metro separately (`pnpm --filter @galena/mobile start`), relaunched
  the app with `xcrun simctl launch booted com.julioferrero.galena`, and it loaded the JS bundle from
  Metro (`iOS Bundled 670ms … (1724 modules)`).
- Screenshots (`xcrun simctl io booted screenshot`):
  - Light (system default): `/private/var/folders/gm/h0mkvrd15q3fvrf_vtbkvh340000gn/T/opencode/galena-ios-2.png`
  - Dark (`xcrun simctl ui booted appearance dark`): `/private/var/folders/gm/h0mkvrd15q3fvrf_vtbkvh340000gn/T/opencode/galena-ios-dark3.png`
  Both render the same screen as the web app; dark mode switches background/foreground automatically.
  (An early screenshot showed a yellow LogBox badge; that came from an interrupted session where
  Metro was not running, and it disappears on a clean launch.)

### Problems, deviations from the spec, open questions

1. **Added an explicit `react-native-css-interop@0.2.7` dependency** (not named in the docs). NativeWind's
   JSX transform emits `import 'react-native-css-interop/jsx-runtime'` into app code; with pnpm's
   isolated `node_modules` that package is only reachable from inside `nativewind`, so Metro failed
   with `Unable to resolve module react-native-css-interop/jsx-runtime`. Declaring the same version
   (nativewind 4.2.7 depends on exactly `0.2.7`) makes it resolvable from the app. This is a normal
   consequence of the mandated isolated linker — **no `nodeLinker` change was made**.
2. **`nativewind-env.d.ts` also references `expo/types`** (`/// <reference types="nativewind/types" />`
   plus `/// <reference types="expo/types" />`). Without it, `tsc --noEmit` failed with `TS2882` on
   `import '@/global.css'` because the `declare module '*.css'` lives in `expo/types/global.d.ts`,
   which is normally pulled in by the generated (and git-ignored) `expo-env.d.ts`. Referencing
   `expo/types` directly keeps `pnpm typecheck` working in a clean checkout.
3. **Layout kept as `src/`** (routes in `src/app`, helpers in `src/lib`) rather than a top-level `app/`.
   The Expo default template uses `src/`, step 7 explicitly asked for `src/lib/`, and Expo Router
   treats `src/app` as the route root ("Using src/app as the root directory for Expo Router"). `@/*`
   maps to `src/*`.
4. **React Native Reusables is copy-in, not a dependency**, so there is no "version" for it; I pinned
   the component copy to the current `nativewind` registry (see above). This is how RNR/shadcn work.
5. **Skipped `prettier-plugin-tailwindcss`**, which the NativeWind install page lists as a dev
   dependency. It is only for class sorting, the root Prettier config does not load any plugin, and it
   is not needed for typecheck/test/build. Adding it would have been an unused dependency.
6. **Peer warning (not a failure):** `@types/react-dom@19.3.0` wants `@types/react@^19.3.0` but the
   Expo SDK 57 template pins `@types/react@~19.2.2` (resolved 19.2.18). `expo-doctor` passes and all
   checks are green; I left the Expo-pinned version rather than fight the template.
7. `apps/mobile/ios/`, `apps/mobile/android/`, `apps/mobile/.expo/`, `apps/mobile/dist/` and
   `apps/mobile/expo-env.d.ts` exist locally from the build/run and are git-ignored; none are committed.

Open questions: none blocking. If you would rather not carry `react-native-css-interop` explicitly,
the alternative is a repo-wide `nodeLinker: hoisted`, which the spec says needs your decision.

---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude after rebasing onto the current `main`.

This is excellent work. The app builds, installs and runs in the iOS simulator, and the report is exact.

### What I verified myself (on commit 80007d9, then again after the rebase)
- **Screenshots:**
  - Light: `/private/var/folders/gm/h0mkvrd15q3fvrf_vtbkvh340000gn/T/opencode/galena-ios-2.png`
  - Dark: `/private/var/folders/gm/h0mkvrd15q3fvrf_vtbkvh340000gn/T/opencode/galena-ios-dark3.png`
  - Both show the correct screen (Galena, subtitle, protocol line), centered. The dark scheme switches correctly.
- No Metro server left running (port 8081 is free).
- After rebasing onto `main` (T-0013, T-0002 and T-0006 had merged), I regenerated the lockfile with `pnpm install`. Then `format:check`, `lint`, `typecheck`, `test` and `build` (including `expo export`) all PASS. Details in the merge commit.

### Findings
1. **(accepted)** The explicit `react-native-css-interop@0.2.7` is the right fix with pnpm's isolated linker. It's much better than a repo-wide `nodeLinker: hoisted`. Keep it in sync with the version NativeWind pins, and add a comment in `apps/mobile/README.md` next time it's touched.
2. **(accepted)** The `expo/types` reference in `nativewind-env.d.ts` fixes typecheck in a clean checkout.
3. **(accepted)** The `src/app` layout is fine. The spec's `app/` meant "the routes folder".
4. **(accepted)** React Native Reusables is copied into the repo on purpose, the same way shadcn works.
5. **(accepted)** Skipping `prettier-plugin-tailwindcss` is fine for now. We can revisit it when the real UI work starts.
6. **(note)** The `@types/react` 19.2 / `@types/react-dom` 19.3 peer warning comes from Expo's pins and is harmless. It resolves with Expo SDK 58.
7. **(process note)** `expo run:ios` leaves Metro running, which caused the 40-minute timeout. Future specs should say to launch with `--no-bundler` or to stop Metro after the build.
