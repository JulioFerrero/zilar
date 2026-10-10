import '@/lib/polyfills';
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
import { ThemeProvider } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Effect } from 'effect';

import { useAuthStore } from '@/auth/session';
import { mobileRuntime } from '@/lib/effect/runtime';
import { NAV_THEME } from '@/lib/theme';
import { ChatStoreProvider } from '@/store/chat-store-provider';

export { ErrorBoundary } from 'expo-router';

// The splash calls are best effort: a failed call is ignored.
const bestEffort = (call: () => Promise<unknown>): Effect.Effect<void> =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(Effect.ignore);

// D24 is dark only: keep the splash up until Geist is loaded, then force dark
// whatever the system setting is.
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

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    colorScheme.set('dark');
  }, []);

  useEffect(() => {
    if (fontsReady) {
      Effect.runFork(bestEffort(() => SplashScreen.hideAsync()));
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME.dark}>
        <StatusBar style="light" />
        <SessionBootstrap />
        <ChatStoreProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ChatStoreProvider>
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
