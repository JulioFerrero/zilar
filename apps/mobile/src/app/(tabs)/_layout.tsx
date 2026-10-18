import { Tabs, TabSlot, TabList, TabTrigger } from 'expo-router/ui';
import { View } from 'react-native';

import { FloatingTabBar, FLOATING_TABS } from '@/components/nav/floating-tab-bar';
import { unreadCount } from '@/lib/filter';
import { useChatStore } from '@/store/chat-store-provider';

export default function TabsLayout() {
  const chats = useChatStore((state) => state.chats);

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
        <FloatingTabBar unreadTotal={unreadCount(chats, undefined)} />
      </View>
    </Tabs>
  );
}
