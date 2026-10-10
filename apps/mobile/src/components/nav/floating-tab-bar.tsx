import { initials } from '@zilar/chat-core';
import { Bot, MessagesSquare, Settings } from 'lucide-react-native';
import { Image, Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { TabTrigger, useTabTrigger } from 'expo-router/ui';

import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, segment } from '@/lib/depth';

import { API_URL } from '@/lib/auth';
import { avatarImageSource } from '@/components/settings/profile-logic';

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_GAP = 12;
export const TAB_BAR_SIDE_MARGIN = 12;

/**
 * Bottom padding for a screen's scroll body. A tab screen scrolls clear of the
 * floating tab bar, so its last row stays tappable; a pushed page with a back
 * key clears the gesture bar by adding the bottom inset to the plain 32.
 */
export function tabScreenBottomPadding(hasBack: boolean, insetBottom: number): number {
  return hasBack ? 32 + insetBottom : TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insetBottom + 16;
}

export interface FloatingTab {
  name: string;
  href: '/' | '/ais' | '/settings' | '/profile';
  label: string;
}

export const FLOATING_TABS: FloatingTab[] = [
  { name: 'index', href: '/', label: 'Chats' },
  { name: 'ais', href: '/ais', label: 'AIs' },
  { name: 'settings', href: '/settings', label: 'Settings' },
  { name: 'profile', href: '/profile', label: 'Profile' },
];

/**
 * Whether the avatar picture failed to load for the *current* url. The
 * failed url is stored instead of a boolean flag, so a fresh `avatarUrl`
 * (e.g. after Set photo saves) clears the initials fallback instead of
 * sticking on it until remount.
 */
export function avatarFailedFor(
  failedUrl: string | undefined,
  avatarUrl: string | undefined,
): boolean {
  return failedUrl !== undefined && failedUrl === avatarUrl;
}

export interface TabProfile {
  id: string;
  name: string;
  avatarUrl?: string | undefined;
  /** The bearer for the same-origin picture load, if any. */
  token?: string | undefined;
}

type FloatingTabBarProps = {
  /** Total unread of non-muted chats (the All folder total); hidden at 0. */
  unreadTotal: number;
  /** The signed-in profile for the Profile tab avatar; initials when absent. */
  profile?: TabProfile | undefined;
};

function TabIcon({
  name,
  profile,
  imageFailed,
  onImageError,
}: {
  name: string;
  profile?: TabProfile | undefined;
  imageFailed: boolean;
  onImageError: () => void;
}) {
  if (name === 'profile') {
    return (
      <TabProfileFace
        profile={profile}
        imageFailed={imageFailed}
        onImageError={onImageError}
        fallback={
          <Text className="text-[13px] font-semibold text-foreground">
            {initials(profile?.name ?? '?')}
          </Text>
        }
      />
    );
  }
  const Icon = name === 'ais' ? Bot : name === 'settings' ? Settings : MessagesSquare;
  return <Icon size={20} color={ICON} />;
}

/**
 * The Profile tab face: the resolved picture, or the initials fallback when
 * there is no picture or the load fails. The server's `avatarUrl` is a
 * relative `/api/avatars/<id>` path, resolved against the API origin with
 * the bearer on same-origin only (the `profile-view` pattern); a bare
 * `Image` uri would never resolve it. The content is hook-free so Vitest
 * covers the fallback without a simulator; the parent owns the failed flag.
 */
export function TabProfileFace({
  profile,
  fallback,
  imageFailed = false,
  onImageError,
}: {
  profile?: TabProfile | undefined;
  fallback: ReactNode;
  imageFailed?: boolean;
  onImageError?: (() => void) | undefined;
}) {
  const source =
    profile?.avatarUrl === undefined || profile.avatarUrl === '' || imageFailed
      ? null
      : avatarImageSource(profile.avatarUrl, API_URL, profile.token);
  if (source === null) {
    return <>{fallback}</>;
  }
  return (
    <Image
      source={source}
      accessibilityLabel="Profile"
      style={{ width: 20, height: 20, borderRadius: 10 }}
      onError={onImageError}
    />
  );
}

/**
 * One tab of the floating bar. Split out so the segment face never swaps a
 * gradient style on a live view: the active and idle faces are different
 * elements, each keyed by its own look (gradient-swap.test.ts).
 */
function FloatingTabButton({
  tab,
  badge,
  profile,
}: {
  tab: FloatingTab;
  badge?: number | undefined;
  profile?: TabProfile | undefined;
}) {
  const { trigger, triggerProps } = useTabTrigger({ name: tab.name });
  const selected = trigger?.isFocused ?? false;
  // The tab-bar avatar falls back to initials when the picture 404s (a
  // removed picture keeps its stale url until the next focus reload). The
  // failed url is stored, not a flag, so a fresh `avatarUrl` clears the
  // fallback instead of sticking on initials until remount.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  return (
    <TabTrigger
      name={tab.name}
      href={tab.href}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      // The face swaps a gradient style (`segment` <-> none), so each face
      // gets a key that changes with the look: Android builds a fresh view
      // instead of swapping the gradient on the live one.
      key={selected ? 'active' : 'idle'}
      style={[{ flex: 1 }, tab.name === 'index' ? { position: 'relative' } : {}]}
      {...triggerProps}
    >
      <View
        className="h-full flex-1 items-center justify-center gap-0.5 rounded-2xl"
        {...(selected ? { style: segment } : {})}
      >
        <TabIcon
          name={tab.name}
          profile={profile}
          imageFailed={avatarFailedFor(failedUrl, profile?.avatarUrl)}
          onImageError={() => setFailedUrl(profile?.avatarUrl)}
        />
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
 * The floating bottom bar (Telegram-style): a dark raised 64 px pill with
 * four equal tabs. Rendered as the `TabList` of the `expo-router/ui` headless
 * `Tabs` in `(tabs)/_layout.tsx`, so `useTabTrigger` switches tabs without a
 * new dependency. Hides while the keyboard is open.
 */
export function FloatingTabBar({ unreadTotal, profile }: FloatingTabBarProps) {
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
          {...(tab.name === 'profile' ? { profile } : {})}
        />
      ))}
    </View>
  );
}
