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
import { Stack, usePathname, useRouter, router, useRootNavigationState } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { ThemeProvider, DarkTheme, type Theme } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { View } from 'react-native';
import { Effect } from 'effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClientVersionCheck as useSharedClientVersionCheck } from '@zilar/client-core';
import { protocolVersion } from '@zilar/protocol';
import * as Notifications from 'expo-notifications';

import { useAuthStore, useSession } from '@/auth/session';
import { UpdateDialog } from '@/components/update/update-dialog';
import { mobileRuntime } from '@/lib/effect/runtime';
import { startAppUpdateChecks } from '@/lib/use-app-update';
import { setActiveChatId } from '@/lib/push/active-chat';
import { waitForCachePaint } from '@/lib/startup-paint';
import { markStartup } from '@/lib/startup-timing';
import { ChatStoreProvider, useChatStoreApi } from '@/store/chat-store-provider';
import { Text } from '@/components/ui/text';
import { API_URL } from '../lib/auth';
import { onForeground } from '../lib/foreground';

// `data.chatId` is the chat JID the routes already use. A live tap navigates at once; a cold-start tap waits for the session and the mounted navigator, or the push is lost.

function chatIdFrom(response: Notifications.NotificationResponse): string | undefined {
  const chatId = response.notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

function openChat(chatId: string): void {
  router.push({ pathname: '/chat/[id]', params: { id: chatId } });
}

function NotificationRouter(): null {
  const status = useSession().status;
  // Undefined until the root navigator mounts; pushing before that throws and would be swallowed.
  const navigationState = useRootNavigationState();
  const navigatorReady = navigationState?.key !== undefined;
  // The cold-start tap is held until the session and the navigator are ready.
  const pendingChat = useRef<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);

  // A live tap navigates directly, but only while the session is signed in.
  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const chatId = chatIdFrom(response);
      if (chatId !== undefined) {
        openChat(chatId);
      }
    });
    return () => subscription.remove();
  }, [status]);

  // Read it once and clear it, so a later mount does not reopen the same chat.
  useEffect(() => {
    let mounted = true;
    void Effect.runPromise(
      Effect.tryPromise({
        try: () => Notifications.getLastNotificationResponseAsync(),
        catch: (error) => error,
      }).pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            if (!mounted || response === null) {
              return;
            }
            const chatId = chatIdFrom(response);
            if (chatId !== undefined) {
              pendingChat.current = chatId;
              setPendingTick((tick) => tick + 1);
            }
            void Notifications.clearLastNotificationResponseAsync();
          }),
        ),
        Effect.ignore,
      ),
    );
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!navigatorReady || status !== 'authenticated') {
      return;
    }
    const chatId = pendingChat.current;
    if (chatId === null) {
      return;
    }
    pendingChat.current = null;
    openChat(chatId);
  }, [navigatorReady, status, pendingTick]);

  return null;
}

const THEME = {
  dark: {
    background: '#0a0a0a',
    foreground: '#ededed',
    card: '#0a0a0a',
    cardForeground: '#ededed',
    popover: '#111111',
    popoverForeground: '#ededed',
    primary: '#ededed',
    primaryForeground: '#0a0a0a',
    secondary: '#111111',
    secondaryForeground: '#ededed',
    muted: '#111111',
    mutedForeground: '#a1a1a1',
    accent: '#ededed',
    accentForeground: '#0a0a0a',
    destructive: '#ef4444',
    border: '#1f1f1f',
    input: '#262626',
    ring: '#a1a1a1',
    radius: '0.75rem',
  },
};

const NAV_THEME: Record<'dark', Theme> = {
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};

const healthRequest = (): Promise<Response> =>
  Effect.runPromise(
    Effect.promise(() => fetch(`${API_URL}/health`, { method: 'GET', credentials: 'omit' })),
  );

function useClientVersionCheck(): boolean {
  return useSharedClientVersionCheck(healthRequest, onForeground, protocolVersion);
}

/**
 * A thin bar when this build is older than the server's minimum client
 * protocol. It sits in the layout flow rather than covering content, and never
 * blocks use.
 */
function ClientVersionBanner() {
  const outdated = useClientVersionCheck();
  const insets = useSafeAreaInsets();

  if (!outdated) {
    return null;
  }

  return (
    <View style={{ paddingTop: insets.top }} className="border-b border-divider bg-accent">
      <Text
        accessibilityRole="alert"
        className="px-3 py-2 text-center text-[13px] text-accent-foreground"
      >
        Please update the app to keep chatting.
      </Text>
    </View>
  );
}

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
