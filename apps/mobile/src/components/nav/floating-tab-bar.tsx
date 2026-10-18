import { Bot, MessagesSquare, Settings } from 'lucide-react-native';
import { Keyboard, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { TabTrigger, useTabTrigger } from 'expo-router/ui';

import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, segment } from '@/lib/depth';
import { emitTabReselect } from '@/lib/tab-reselect';

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_GAP = 12;
export const TAB_BAR_SIDE_MARGIN = 12;

/**
 * Bottom padding for a screen's scroll body: a tab screen scrolls clear of the
 * floating bar, and a pushed page clears the gesture bar with the inset on
 * top of the plain 32.
 */
export function tabScreenBottomPadding(hasBack: boolean, insetBottom: number): number {
  return hasBack ? 32 + insetBottom : TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insetBottom + 16;
}

export interface FloatingTab {
  name: string;
  href: '/' | '/ais' | '/settings';
  label: string;
}

export const FLOATING_TABS: FloatingTab[] = [
  { name: 'index', href: '/', label: 'Chats' },
  { name: 'ais', href: '/ais', label: 'AIs' },
  { name: 'settings', href: '/settings', label: 'Settings' },
];

type FloatingTabBarProps = {
  unreadTotal: number;
};

function TabIcon({ name }: { name: string }) {
  const Icon = name === 'ais' ? Bot : name === 'settings' ? Settings : MessagesSquare;
  return <Icon size={20} color={ICON} />;
}

/**
 * One tab of the floating bar, split out so the face never swaps a gradient
 * style on a live view: the active and idle faces are different elements,
 * each keyed by its own look (gradient-swap.test.ts).
 */
function FloatingTabButton({ tab, badge }: { tab: FloatingTab; badge?: number | undefined }) {
  const { trigger, triggerProps } = useTabTrigger({ name: tab.name });
  const selected = trigger?.isFocused ?? false;
  // Tapping the tab you are already on scrolls its list to the top instead of navigating.
  const onPress = (event: GestureResponderEvent): void => {
    if (selected) {
      emitTabReselect(tab.name);
      return;
    }
    triggerProps.onPress?.(event);
  };
  return (
    <TabTrigger
      name={tab.name}
      href={tab.href}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      // The face swaps a gradient style (`segment` <-> none), so each face gets
      // a key that changes with the look: Android then builds a fresh view.
      key={selected ? 'active' : 'idle'}
      style={[{ flex: 1 }, tab.name === 'index' ? { position: 'relative' } : {}]}
      {...triggerProps}
      onPress={onPress}
    >
      <View
        className="h-full flex-1 items-center justify-center gap-0.5 rounded-2xl"
        {...(selected ? { style: segment } : {})}
      >
        <TabIcon name={tab.name} />
        <Text className="text-[11px]" style={{ color: selected ? '#ededed' : MUTED_FOREGROUND }}>
          {tab.label}
        </Text>
      </View>
      {badge !== undefined && badge > 0 ? (
        <View
          accessibilityLabel={`${badge} unread chats`}
          className="absolute right-3 top-1 min-w-5 items-center justify-center rounded-full px-1"
          style={[primaryKey, { minHeight: 18 }]}
        >
          <Text className="text-[11px] font-semibold" style={{ color: '#0a0a0a' }}>
            {badge > 99 ? '99+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </TabTrigger>
  );
}

/**
 * The floating bottom bar: a dark raised 64 px pill with three equal tabs, the
 * `TabList` of the `expo-router/ui` headless `Tabs`, so `useTabTrigger`
 * switches tabs. Hides while the keyboard is open.
 */
export function FloatingTabBar({ unreadTotal }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboardOpen) {
    return null;
  }
  return (
    <View
      className="absolute flex-row items-stretch rounded-[22px] p-1.5"
      style={{
        left: TAB_BAR_SIDE_MARGIN,
        right: TAB_BAR_SIDE_MARGIN,
        bottom: insets.bottom + TAB_BAR_BOTTOM_GAP,
        height: TAB_BAR_HEIGHT,
        backgroundColor: '#141414',
        experimental_backgroundImage: 'linear-gradient(180deg, #1b1b1b, #0e0e0e)',
        borderWidth: 1,
        borderColor: '#050505',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.09), 0 1px 0 rgba(0,0,0,0.95), 0 8px 24px -6px rgba(0,0,0,0.9)',
      }}
    >
      {FLOATING_TABS.map((tab) => (
        <FloatingTabButton
          key={tab.name}
          tab={tab}
          {...(tab.name === 'index' ? { badge: unreadTotal } : {})}
        />
      ))}
    </View>
  );
}
