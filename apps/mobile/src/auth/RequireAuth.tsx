import { Redirect, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';

import { guardDecision } from './guard';
import { useSession } from './session';

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator color={ACCENT} />
      <Text className="mt-3 text-[15px] text-muted-foreground">Loading…</Text>
    </View>
  );
}

/** Requires a session, but not a display name (the `/welcome/name` step). */
export function RequireUser({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'guest') {
    return <Redirect href="/login" />;
  }
  return <>{children}</>;
}

/** Requires a session and a display name; preserves the target for after login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const pathname = usePathname();
  const decision = guardDecision({ status, name: me?.name, target: pathname });

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
