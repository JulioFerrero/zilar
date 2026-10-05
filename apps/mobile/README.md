# @zilar/mobile

The Zilar mobile app: an [Expo](https://expo.dev) (SDK 57) app using
[Expo Router](https://docs.expo.dev/router/introduction),
[NativeWind](https://www.nativewind.dev) and
[React Native Reusables](https://reactnativereusables.com).

For now it shows the messenger-style chat shell from T-0019 (mock data), polished
in T-0023: the chat list with folder tabs, search, typing and the new-chat menu;
the chat screen with bubbles, an unread divider, big emoji, safe links, reply
quotes, swipe-to-reply, long-press actions and the composer. Shared pure logic
(time, avatars, grouping, previews, big emoji, links, the unread divider) lives
in `@zilar/chat-core`. It also proves the monorepo wiring (Expo + pnpm + Metro
resolving a TypeScript workspace package) and the styling stack.

## Requirements

- Node 24 (see `.nvmrc`)
- For the iOS simulator: macOS with Xcode, its command line tools and CocoaPods installed.
- For Android: Android Studio with an emulator, or a device with `adb`.

## Run it

Install from the repo root first, then start the dev server:

```bash
pnpm install
pnpm --filter @zilar/mobile start
```

`start` opens the Expo dev server; press `i` for the iOS simulator or `a` for Android.

To build and launch a local native app (a "dev build", not Expo Go):

```bash
pnpm --filter @zilar/mobile ios        # Xcode simulator
pnpm --filter @zilar/mobile android    # Android emulator or device
```

`expo run:ios` / `expo run:android` generate the native `ios/` and `android/` projects, compile
them and install the app. To run on a physical phone, connect it, run one of those commands, or
use `pnpm --filter @zilar/mobile start` and scan the QR code with a development build of the app
installed on the phone.

## Boot check

`boot:ios` is the one command that proves the iOS app actually starts: it makes
sure the generated `ios/` project matches the dependencies (running
`pod install`/`expo prebuild` when it does not), verifies `node_modules`
matches the lockfile, starts Metro on port **8082**, builds and installs with
`expo run:ios --no-bundler`, launches the app on a simulator, and watches the
Metro log plus the simulator's app log for errors (`Cannot find native module`,
`Unable to resolve`, red-box `ERROR`, `Invariant Violation`, the bundle never
loading, or the app process exiting). It only passes once the bundle loaded
**and** the app log shows the JS app actually ran (`Running "main" with …`),
then waits a settle window before taking the screenshot.

```bash
pnpm --filter @zilar/mobile boot:ios --device <simulator-udid>
```

Options: `--device <udid>` (required), `--port <n>` (default 8082, 8081 is
refused), `--timeout <s>` (default 90) and `--settle <s>` (default 5). It always
saves a screenshot and both logs under `apps/mobile/.expo/boot-check/<timestamp>/`,
stops only the Metro process it started, and exits non-zero with a one-line
reason on failure. Never point it at a simulator or Metro port someone else is
using.

## Scripts

| Command | What it does |
|---|---|
| `start` | `expo start` — the Metro dev server |
| `ios` / `android` | Local native dev build (`expo run:*`) |
| `boot:ios` | Build, install, launch and watch the app on a simulator (see above) |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `build` | `expo export` for iOS and Android (JavaScript bundle only, no native build) |

## Generated native folders

`ios/` and `android/` are **generated** by Expo (prebuild / CNG) and are **git-ignored**. Do not
commit them and do not edit them by hand: change `app.json` or a config plugin instead, then rerun
`expo prebuild --clean`.

## Layout

```
src/
  app/           # Expo Router routes (index.tsx = chat list, chat/[id].tsx = chat screen)
  components/    # React Native Reusables components (ui/) and chat components (chat/)
  lib/           # mobile-only helpers (format, links, chat, filter, colors) + tests
  mock/          # mock chats and messages until the real data lands
  store/         # zustand chat store (sendText, openChat, typing, search, folders)
  global.css     # Tailwind entry + Zilar CSS variables (light and dark)
  screenshots/   # simulator screenshots, committed for review
```

`@/*` maps to `src/*` (see `tsconfig.json`). Styling uses NativeWind (Tailwind classes); the
component copies come from React Native Reusables and live under `src/components/ui`. Shared pure
logic comes from `@zilar/chat-core`; `src/lib` keeps only what is mobile-specific. The app root is
wrapped in `GestureHandlerRootView` for `react-native-gesture-handler` (swipe-to-reply) and
`react-native-reanimated` (animated dots and the swipe arrow).

`react-native-css-interop` is pinned to the exact version NativeWind depends on (0.2.7). The NativeWind
JSX transform imports `react-native-css-interop/jsx-runtime` from app code, and pnpm's isolated
`node_modules` otherwise hides it. Keep both versions in sync when upgrading NativeWind.
