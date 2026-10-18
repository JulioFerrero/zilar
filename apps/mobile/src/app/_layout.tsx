import '@/lib/polyfills';
import '@/lib/push/background';
import '@/global.css';

// Each face is imported from its own file: the package index requires all 36 TTFs, and Metro would bundle every one (about 3.5 MB).
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { ThemeProvider } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
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
import { waitForCachePaint } from '@/lib/startup-paint';
import { markStartup } from '@/lib/startup-timing';
import { NAV_THEME } from '@/lib/theme';
import { ChatStoreProvider, useChatStoreApi } from '@/store/chat-store-provider';

export { ErrorBoundary } from 'expo-router';

const bestEffort = (call: () => Promise<unknown>): Effect.Effect<void> =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(Effect.ignore);

// How long the root may wait for the primary font before it renders anyway; the secondary faces keep loading in the background.
const FONT_READY_CAP_MS = 1_000;

// After the fonts, the splash may wait this long for the cached list and messages to paint, so a cold start opens on content, not a skeleton.
const CACHE_PAINT_CAP_MS = 400;

Effect.runFork(bestEffort(() => SplashScreen.preventAutoHideAsync()));

// Keeps the Effect runtime (and FetchHttpClient) in the bundle so the Hermes export checks it.
void mobileRuntime;

function SessionBootstrap() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    Effect.runFork(Effect.promise(() => bootstrap()));
  }, [bootstrap]);

  return null;
}

function ActiveChatSync() {
  const store = useChatStoreApi();

  useEffect(() => {
    const sync = () => setActiveChatId(store.getState().activeChatId);
    sync();
    return store.subscribe(sync);
  }, [store]);

  return null;
}

/**
 * Opens `/share` when an Android share arrives: a SEND intent carries no linking URL, so the `+native-intent` branch alone cannot route it. Only the transition to `hasShareIntent` navigates, once, and never over `/share` itself.
 */
function ShareIntentRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { hasShareIntent } = useShareIntentContext();
  const redirected = useRef(false);

  useEffect(() => {
    if (hasShareIntent && !redirected.current && pathname !== '/share') {
      redirected.current = true;
      router.push('/share');
    }
    if (!hasShareIntent) {
      redirected.current = false;
    }
  }, [hasShareIntent, pathname, router]);

  return null;
}

export default function RootLayout() {
  // The primary font gates the first paint only, or the 1 s cap: a slow secondary face must not hold the cold start.
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

  useEffect(() => {
    startAppUpdateChecks();
  }, []);

  useEffect(() => {
    if (!fontsReady) {
      return;
    }
    // Hold the splash until the store has painted the cached list and messages, capped so a start that never marks (signed out) still shows.
    let cancelled = false;
    markStartup('fonts-ready');
    void waitForCachePaint(CACHE_PAINT_CAP_MS).then(() => {
      if (!cancelled) {
        Effect.runFork(bestEffort(() => SplashScreen.hideAsync()));
      }
    });
    return () => {
      cancelled = true;
    };
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
            <ShareIntentRedirect />
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
