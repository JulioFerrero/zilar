import '@/lib/polyfills';
import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuthStore } from '@/auth/session';
import { NAV_THEME } from '@/lib/theme';
import { ChatStoreProvider } from '@/store/chat-store-provider';

export { ErrorBoundary } from 'expo-router';

/** Restores the persisted session once, on app start. */
function SessionBootstrap() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return null;
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <SessionBootstrap />
        <ChatStoreProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ChatStoreProvider>
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
