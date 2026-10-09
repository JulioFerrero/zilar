import { Tabs, TabSlot, TabList, TabTrigger } from 'expo-router/ui';
import { Effect, Fiber } from 'effect';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';

import { FloatingTabBar, FLOATING_TABS } from '@/components/nav/floating-tab-bar';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { fromApi } from '@/lib/effect/api-effect';
import { unreadCount } from '@/lib/filter';
import { getSessionToken } from '@/lib/session-token';
import { useChatStore } from '@/store/chat-store-provider';
import type { TabProfile } from '@/components/nav/floating-tab-bar';

// The session token as an Effect: a failed read fails the profile load.
const sessionTokenEffect = Effect.tryPromise({
  try: () => getSessionToken(),
  catch: (cause) => cause,
});

/**
 * The four phone tabs (Chats, AIs, Settings, Profile). Each `TabTrigger`
 * names the route file inside this group (`index`, `ais`, `settings`,
 * `profile`); the `href` is the public URL, so `/`, `/ais` and `/settings`
 * stay exactly as today. Sub-screens (`ais/[id]`, `settings/*`, `chat/*`)
 * live outside the group and open above the bar on the root stack.
 */
export default function TabsLayout() {
  const chats = useChatStore((state) => state.chats);
  const { api } = useProfileApi();
  const [profile, setProfile] = useState<TabProfile | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      // Leaving the tab interrupts a load still in flight, so a late answer
      // never sets the profile of a tab that is no longer shown.
      const load = Effect.all([fromApi(() => api.getMe()), sessionTokenEffect], {
        concurrency: 'unbounded',
      }).pipe(
        Effect.tap(([me, sessionToken]) =>
          Effect.sync(() => {
            const next: TabProfile =
              me.avatarUrl === undefined
                ? { id: me.id, name: me.name }
                : { id: me.id, name: me.name, avatarUrl: me.avatarUrl };
            setProfile(sessionToken === undefined ? next : { ...next, token: sessionToken });
          }),
        ),
        Effect.catch(() => Effect.sync(() => setProfile(undefined))),
      );
      const fiber = Effect.runFork(load);
      return () => {
        Effect.runFork(Fiber.interrupt(fiber));
      };
    }, [api]),
  );

  return (
    <Tabs>
      <TabSlot />
      {/*
       * The trigger registry: headless tabs only know the tabs declared as
       * `TabTrigger` children of `TabList`. The visible floating bar below
       * reuses the same trigger map through `useTabTrigger`, so this list
       * carries no UI of its own.
       */}
      <TabList style={{ display: 'none' }}>
        {FLOATING_TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} />
        ))}
      </TabList>
      {/*
       * Rendered inside `NavigationContent` (not inside `TabList`), so the
       * trigger parser ignores it and it floats above the active tab.
       */}
      <View
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }}
        pointerEvents="box-none"
      >
        <FloatingTabBar unreadTotal={unreadCount(chats, undefined)} profile={profile} />
      </View>
    </Tabs>
  );
}
