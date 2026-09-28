---
id: T-0048
title: Mobile redesign (D24): dark tokens, Geist, skeuomorphic primitives, chat list and chat screen
status: planned
milestone: M2
branch: task/T-0048-mobile-redesign
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0046, T-0047]
estimate: 2 days
---

# T-0048: Mobile redesign (D24)

## Spec (written by Claude, do not edit)

### Goal

The web app now has Julio's approved D24 look: a black Vercel-style dark theme with real skeuomorphic depth on buttons and bubbles (T-0046 and T-0047, merged). The Expo app still has the old Telegram blue theme. This task brings the **mobile app** to D24: the same tokens, font, depth recipes and bubble looks, adapted to a phone.

**Quality bar:** the chat list must look like `docs/design/mockups/Mobile.dc.html`. The chat screen must look like the chat panel of `Main.dc.html` at phone width, and like the web app's 390 px screenshots in `work/screenshots/T-0047/*-390.png`. Put your screenshots next to those and compare them yourself.

This is a **visual task**. Store logic, API calls, navigation and behavior don't change.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: all of it. §1 "Narrow web and mobile", §2 tokens, §4 depth recipes (exact shadows) and §5 components are what you build.
- `docs/design/mockups/README.md`, `Mobile.dc.html` (the mobile list, 390×844) and `Main.dc.html` (the chat panel and bubble classes). Read the exact values in the `<style>` blocks.
- The web implementation, for reference only (don't import from it): `apps/web/src/index.css` (the `bubble-out`, `bubble-in`, `raised-pill`, `well` utilities) and `apps/web/src/components/ui/*` (the key variants).
- `work/screenshots/T-0047/*-390.png`: the web result at phone width.
- `work/T-0037-mobile-my-ais.md`, "Visual check": how to run your own simulator safely.
- The mobile code you restyle: `src/global.css`, `tailwind.config.js`, `src/lib/theme.ts`, `src/lib/colors.ts`, `src/app/_layout.tsx`, `src/app/index.tsx`, `src/app/chat/[id].tsx`, `src/components/ui/*`, `src/components/chat/*`.

### Allowed files (all under `apps/mobile/`)
- `src/global.css`, `tailwind.config.js`, `src/lib/theme.ts`, `src/lib/colors.ts`
- `src/lib/depth.ts` (new), plus `src/lib/depth.test.ts` (new)
- `src/app/_layout.tsx`: fonts and forced dark only
- `app.json`: `userInterfaceStyle` and the splash background color only
- `package.json` and the root `pnpm-lock.yaml`: only for the dependencies below
- `src/components/ui/**`
- `src/components/chat/**`: visual changes only
- `src/app/index.tsx` and `src/app/chat/[id].tsx`: layout and styling only
- `src/components/ais/**`, `src/app/ais/**` and `src/auth/*.tsx`: **only** to swap a class that looks broken under the new tokens (for example a leftover blue). No layout rework on those screens.
- `apps/mobile/screenshots/T-0048/**` (new): the only binary files allowed
- `work/T-0048-mobile-redesign.md`

**Not allowed:** `src/store/**`, `src/lib/*-api.ts`, `src/auth/*.ts` (logic), `src/mock/**`, `apps/web/**`, `apps/server/**`, `packages/**`, `docs/**`.

### Allowed dependencies
- `@expo-google-fonts/geist` and `@expo-google-fonts/geist-mono`, plus `expo-font` if it isn't already a direct dependency. Install them with `pnpm --filter @galena/mobile exec expo install <names>`, so the versions match the Expo SDK.
- Nothing else. `expo-linear-gradient` and `react-native-svg` are already there.

Adding `expo-font` is a native change: rebuild your simulator app with `boot:ios` (see Visual check).

### What to build

**1. Theme: dark only.**
- Replace the Telegram tokens in `global.css` with the D24 tokens from `ui-style.md` §2, with the same names the web uses wherever they apply (`--background` `#000`, `--surface` `#0a0a0a`, `--border`, `--edge`, `--well`, `--foreground` `#ededed`, `--muted-foreground`, `--subtle-foreground`, `--accent` `#ededed` and so on, plus the bubble tokens).
- Keep the Tailwind color names that other screens use (`primary`, `muted`, `card`, `destructive`, `online`, `danger`...) and point them at the D24 values, so the My AIs and auth screens restyle themselves.
- The app is always dark: force it (`userInterfaceStyle: "dark"`, NativeWind's `colorScheme.set('dark')` or the equivalent in `_layout.tsx`, and `NAV_THEME` dark). The status bar is light.

**2. Fonts.** Load Geist (400, 500, 600) and Geist Mono (400, 500) in `_layout.tsx` with `useFonts`, keeping the splash screen up until they load. Map them in Tailwind (`font-sans`, `font-medium`, `font-semibold`, `font-mono`). On React Native each weight is its own font family, so map the weight classes to the right family.

**3. Depth primitives: one module, `src/lib/depth.ts`.**
- Implement the four recipes from §4 once each: **primary key**, **icon key**, **well**, **raised segment/pill**. Also add the bubble looks: **outgoing** (glossy white) and **incoming** (dark card).
- Use React Native's `boxShadow` style (a CSS string with `inset` and several shadows, supported on the New Architecture) with the **exact** shadow values from §4. For gradients, use `expo-linear-gradient`, or `experimental_backgroundImage` if it renders correctly on iOS. Check it visually either way.
- Pressed states: translate 1 px and swap to the pressed shadow, through `Pressable`'s `pressed` state. No press translation with reduced motion.
- Components use these recipes through `src/components/ui/*`. Don't copy shadow strings into screens.
- Add a `Key` (primary) variant to `ui/button.tsx` and restyle `ui/icon-button.tsx` as the icon key (12 px radius on mobile, `#d4d4d4` icons).

**4. Chat list (home), per `Mobile.dc.html`.**
- A large title `Chats` (28/600).
- If the list already has a search field, make it a well. Don't add search if there isn't one.
- The folder tabs as a segmented control: a well track with the raised active segment.
- Rows with 52 px avatars, hairline `#1a1a1a` separators, mono times, the mono `AI` badge, and unread badges as the primary pill (muted ones as a raised pill).
- The **+** new-chat button: a 56 px primary key with an 18 px radius, bottom right, above the safe area.
- Avatars: the same neutral monochrome look as the web (`Avatar` in `apps/web/src/components/`), not the old colored gradients.

**5. Chat screen, per the chat panel in `Main.dc.html` and the web's 390 px screenshots.**
- **Header:** `--surface` with a bottom border; the back button and the more button are icon keys; a 36 px avatar, name 15/600, the mono `AI` badge, subtitle 12.
- **Background:** black with the dot grid if you can draw it cheaply (an `react-native-svg` pattern); otherwise plain `#000`. Say which one you chose.
- **Bubbles:**
  - outgoing: glossy white, `#0a0a0a` text, `#525252` mono meta;
  - incoming: the dark card;
  - radius 14 with a 4 px tail corner on the last bubble of a group only;
  - keep the grouping (2 px within a group, 8 px between groups);
  - in groups, keep sender names and avatars, with the same monochrome-friendly sender colors as the web (`MessageBubble.tsx`, `SENDER_COLORS`);
  - big emoji have no bubble, and their time sits on a raised pill;
  - links: `#ededed` underlined in incoming bubbles, `#0a0a0a` underlined in outgoing ones.
- **Date separator:** a raised pill. **Unread divider:** a well strip with muted text.
- **Composer:** a well (14 px radius, 8 px padding) with:
  - the attach icon key;
  - the auto-growing input (placeholder `Message <chat title>`);
  - the mic icon key when empty, and the **send primary key** (36 px, 10 px radius, arrow-up icon) when there is text.
  The reply bar above it is a well strip with a `#333` left bar. Keep every behavior: swipe-to-reply, the actions sheet, keyboard avoidance.
- **Rich messages:**
  - voice: the play button is a primary key (circle); the waveform is `#ededed` for the played part and `#525252` for the rest;
  - images: 12 px radius, an `--edge` border, the time on a raised pill;
  - reply quotes: a `#333` bar, the name `#d4d4d4`, a muted excerpt;
  - progress and approval cards: the incoming-card look, **Approve** as a primary key and **Deny** as an outline key;
  - the message actions sheet: `--surface` with a `--border-strong` top border and a 16 px top radius.
- The typing indicator and ticks: restyle with the tokens (ticks `#525252` in outgoing bubbles).

**6. Other screens.** My AIs, the New AI wizard and the auth screens pick up the new tokens automatically. Screenshot them once each and fix only what looks broken (leftover blue, unreadable contrast) by swapping classes.

**7. Reduced motion** (`AccessibilityInfo.isReduceMotionEnabled` or Reanimated's `useReducedMotion`): no press translation and no pulsing.

### Tests (Vitest, no network)
- `src/lib/depth.test.ts`: each recipe exists, uses the exact shadow values from `ui-style.md` §4, and has a pressed variant where §4 defines one.
- If you extract pure helpers (sender color, a style picker for bubble looks), test them.
- All existing mobile tests still pass, unchanged.

### Visual check (you have vision: use it)
- **Simulator:** follow T-0037's rules exactly.
  - Create your **own** simulator (`xcrun simctl create "Galena T-0048" "iPhone 17"`) and boot it.
  - **Never** touch Julio's iPhone `DB167CD4-…` or iPad `A3E0C081-…`.
  - Never run `simctl shutdown all` or `erase`.
  - Run `pnpm --filter @galena/mobile boot:ios --device <your-udid>` in mock mode (`EXPO_PUBLIC_GALENA_MOCK=1`). Its Metro runs on 8082. **Never use 8081**; that's Julio's.
  - At the end, stop your Metro, then shut down and delete **only your** simulator, by its UDID.
- **Screenshots** (`xcrun simctl io <udid> screenshot`), saved to `apps/mobile/screenshots/T-0048/`:
  - the chat list;
  - a DM;
  - a group;
  - the voice and image chat;
  - the approval card;
  - the composer with text, with the keyboard up;
  - the reply bar;
  - the actions sheet;
  - My AIs;
  - one auth screen.
- **Image budget:** your session has a cap on images (gotcha 17). Look at each screenshot **once**, downscaled if you can (`sips -Z 900`), and at most ~20 images in total. Compare against `Mobile.dc.html` and the web's `*-390.png` from their source values rather than rendering the mockups yourself.
- In the Report, list the differences from the mockup you chose to keep.

### Acceptance criteria
- [ ] Every check below passes.
- [ ] The list and chat screens match the mockups; the depth recipes live only in `depth.ts` and `ui/*`.
- [ ] The app is dark only, with Geist loaded, and no Telegram blue is left on any screen you screenshotted.
- [ ] Behavior is unchanged (swipe-to-reply, the sheets, keyboard, navigation).
- [ ] Only the Allowed files changed.
- [ ] Your simulator is deleted, and Julio's simulators and Metro were untouched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/mobile
pnpm --filter @galena/mobile build
```

### Out of scope
- Reply drafts on mobile (a separate follow-up), and so the generating bubble.
- A light theme and the accent setting.
- New features (search, if the list has none).

## Report (written by the worker when done)

## Review (written by Claude)
