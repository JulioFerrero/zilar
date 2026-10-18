import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { ENV_MOCK, ENV_NODE_ENV, isMockMode } from '@/mock/gate';

import { guardDecision } from './guard';
import { useSession } from './session';

// Mock mode is a dev build (or `EXPO_PUBLIC_ZILAR_MOCK`) only, so a release build never takes this branch.
const MOCK_USER_NAME = 'You';

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator color={ACCENT} />
      <Text className="mt-3 text-[15px] text-muted-foreground">Loading…</Text>
    </View>
  );
}

export function RequireUser({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  // An offline session with no known user is still loading: the retry may bring one back.
  if (status === 'loading' || (status === 'offline' && me === null)) {
    return <LoadingScreen />;
  }
  if (status === 'guest') {
    return <Redirect href="/login" />;
  }
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  // In mock mode nobody logs in, but the app opens straight into the tabs on the mock user.
  const mock = isMockMode(params, { dev: __DEV__, envMock: ENV_MOCK, nodeEnv: ENV_NODE_ENV });
  const decision = guardDecision({
    status: mock ? 'authenticated' : status,
    name: mock ? MOCK_USER_NAME : me?.name,
    target: pathname,
  });

  if (decision.kind === 'loading') {
    return <LoadingScreen />;
  }
  if (decision.kind === 'login') {
    return <Redirect href={`/login?from=${encodeURIComponent(decision.from)}`} />;
  }
  if (decision.kind === 'name') {
    return <Redirect href="/welcome/name" />;
  }
  return <>{children}</>;
}
