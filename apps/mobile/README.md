# @galena/mobile

The Galena mobile app: an [Expo](https://expo.dev) (SDK 57) app using
[Expo Router](https://docs.expo.dev/router/introduction),
[NativeWind](https://www.nativewind.dev) and
[React Native Reusables](https://reactnativereusables.com).

For now it shows the Telegram-like chat shell from T-0019 (mock data), polished
in T-0023: the chat list with folder tabs, search, typing and the new-chat menu;
the chat screen with bubbles, an unread divider, big emoji, safe links, reply
quotes, swipe-to-reply, long-press actions and the composer. Shared pure logic
(time, avatars, grouping, previews, big emoji, links, the unread divider) lives
in `@galena/chat-core`. It also proves the monorepo wiring (Expo + pnpm + Metro
resolving a TypeScript workspace package) and the styling stack.

## Requirements

- Node 24 (see `.nvmrc`)
- For the iOS simulator: macOS with Xcode, its command line tools and CocoaPods installed.
- For Android: Android Studio with an emulator, or a device with `adb`.

## Run it

Install from the repo root first, then start the dev server:

```bash
pnpm install
pnpm --filter @galena/mobile start
```

`start` opens the Expo dev server; press `i` for the iOS simulator or `a` for Android.

To build and launch a local native app (a "dev build", not Expo Go):

```bash
pnpm --filter @galena/mobile ios        # Xcode simulator
pnpm --filter @galena/mobile android    # Android emulator or device
```

`expo run:ios` / `expo run:android` generate the native `ios/` and `android/` projects, compile
them and install the app. To run on a physical phone, connect it, run one of those commands, or
use `pnpm --filter @galena/mobile start` and scan the QR code with a development build of the app
installed on the phone.

## Scripts

| Command | What it does |
|---|---|
| `start` | `expo start` — the Metro dev server |
| `ios` / `android` | Local native dev build (`expo run:*`) |
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
  global.css     # Tailwind entry + Galena CSS variables (light and dark)
  screenshots/   # simulator screenshots, committed for review
```

`@/*` maps to `src/*` (see `tsconfig.json`). Styling uses NativeWind (Tailwind classes); the
component copies come from React Native Reusables and live under `src/components/ui`. Shared pure
logic comes from `@galena/chat-core`; `src/lib` keeps only what is mobile-specific. The app root is
wrapped in `GestureHandlerRootView` for `react-native-gesture-handler` (swipe-to-reply) and
`react-native-reanimated` (animated dots and the swipe arrow).

`react-native-css-interop` is pinned to the exact version NativeWind depends on (0.2.7). The NativeWind
JSX transform imports `react-native-css-interop/jsx-runtime` from app code, and pnpm's isolated
`node_modules` otherwise hides it. Keep both versions in sync when upgrading NativeWind.
