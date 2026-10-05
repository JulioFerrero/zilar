import { Tabs, TabSlot, TabList, TabTrigger } from 'expo-router/ui';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';

import { FloatingTabBar, FLOATING_TABS } from '@/components/nav/floating-tab-bar';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { unreadCount } from '@/lib/filter';
import { getSessionToken } from '@/lib/session-token';
import { useChatStore } from '@/store/chat-store-provider';
import type { TabProfile } from '@/components/nav/floating-tab-bar';

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
      let active = true;
      void Promise.all([api.getMe(), getSessionToken()])
        .then(([me, sessionToken]) => {
          if (active) {
            const next: TabProfile =
              me.avatarUrl === undefined
                ? { id: me.id, name: me.name }
                : { id: me.id, name: me.name, avatarUrl: me.avatarUrl };
            setProfile(sessionToken === undefined ? next : { ...next, token: sessionToken });
          }
        })
        .catch(() => {
          if (active) {
            setProfile(undefined);
          }
        });
      return () => {
        active = false;
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
        <FloatingTabBar unreadTotal={unreadCount(chats, 'all')} profile={profile} />
      </View>
    </Tabs>
  );
}
