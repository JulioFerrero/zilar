import '@/lib/polyfills';
import '@/global.css';

import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuthStore } from '@/auth/session';
import { NAV_THEME } from '@/lib/theme';
import { ChatStoreProvider } from '@/store/chat-store-provider';

export { ErrorBoundary } from 'expo-router';

// D24 is dark only: keep the splash up until Geist is loaded, then force dark
// whatever the system setting is.
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Restores the persisted session once, on app start. */
function SessionBootstrap() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
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
      void SplashScreen.hideAsync().catch(() => {});
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
