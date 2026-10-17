import '@/lib/polyfills';
// Defines and registers the headless FCM wake task before any route mounts.
import '@/lib/push/background';
import '@/global.css';

// Each face is imported from its own file: the package index requires all 36
// TTFs, and Metro would bundle every one of them (about 3.5 MB).
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { ThemeProvider } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { View } from 'react-native';
import { Effect } from 'effect';

import { useAuthStore } from '@/auth/session';
import { ClientVersionBanner } from '@/components/client-version-banner';
import { UpdateDialog } from '@/components/update/update-dialog';
import { mobileRuntime } from '@/lib/effect/runtime';
import { startAppUpdateChecks } from '@/lib/use-app-update';
import { setActiveChatId } from '@/lib/push/active-chat';
import { NotificationRouter } from '@/lib/push/tap';
import { markStartup } from '@/lib/startup-timing';
import { NAV_THEME } from '@/lib/theme';
import { ChatStoreProvider, useChatStoreApi } from '@/store/chat-store-provider';

export { ErrorBoundary } from 'expo-router';

// The splash calls are best effort: a failed call is ignored.
const bestEffort = (call: () => Promise<unknown>): Effect.Effect<void> =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(Effect.ignore);

// How long the root may wait for the primary font before it renders anyway
// (PERF-12); the secondary faces keep loading in the background.
const FONT_READY_CAP_MS = 1_000;

// D24 is dark only: keep the splash up until the primary Geist face is loaded,
// then force dark whatever the system setting is.
Effect.runFork(bestEffort(() => SplashScreen.preventAutoHideAsync()));

// Keeps the Effect runtime (and FetchHttpClient) in the bundle so the Hermes
// export checks it; the mobile Effect tasks build on it (T-0800, decision D6).
void mobileRuntime;

/** Restores the persisted session once, on app start. */
function SessionBootstrap() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    Effect.runFork(Effect.promise(() => bootstrap()));
  }, [bootstrap]);

  return null;
}

/**
 * Mirrors the store's open chat into the push module (T-1358), so `onWake`
 * and the foreground notification handler stay silent for the one chat the
 * user is already reading. Must be inside `ChatStoreProvider`.
 */
function ActiveChatSync() {
  const store = useChatStoreApi();

  useEffect(() => {
    const sync = () => setActiveChatId(store.getState().activeChatId);
    sync();
    return store.subscribe(sync);
  }, [store]);

  return null;
}

export default function RootLayout() {
  // The primary text font (`font-sans` → Geist_400Regular, tailwind.config.js)
  // gates the first paint only, or the 1 s cap: a slow secondary face must not
  // hold the cold start (PERF-12). The other faces load in the background.
  const [primaryLoaded, primaryError] = useFonts({ Geist_400Regular });
  useFonts({
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  const [fontCapReached, setFontCapReached] = useState(false);
  const fontsReady = primaryLoaded || primaryError !== null || fontCapReached;

  useEffect(() => {
    const timer = setTimeout(() => setFontCapReached(true), FONT_READY_CAP_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    colorScheme.set('dark');
  }, []);

  // Starts the Android updater once (T-1725): one auto check and one on each
  // return to the foreground. It does nothing on iOS, in dev or in local builds.
  useEffect(() => {
    startAppUpdateChecks();
  }, []);

  useEffect(() => {
    if (fontsReady) {
      markStartup('fonts-ready');
      Effect.runFork(bestEffort(() => SplashScreen.hideAsync()));
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider value={NAV_THEME.dark}>
          <StatusBar style="light" />
          <SessionBootstrap />
          <NotificationRouter />
          {/* T-1891: share-sheet payloads (Android SEND); the /share route reads them (share plan). */}
          <ShareIntentProvider options={{ resetOnBackground: true }}>
            <ChatStoreProvider>
              <ActiveChatSync />
              <View style={{ flex: 1 }}>
                <ClientVersionBanner />
                <Stack screenOptions={{ headerShown: false }} />
                <UpdateDialog />
              </View>
            </ChatStoreProvider>
          </ShareIntentProvider>
          <PortalHost />
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
