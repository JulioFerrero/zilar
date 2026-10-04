import { useFocusEffect, useRouter } from 'expo-router';
import {
  Bot,
  ChevronRight,
  KeyRound,
  Plug,
  Server,
  ShieldCheck,
  UserPlus,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { useAuthStore } from '@/auth/session';
import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import type { MyProfile } from '@/lib/profile-api';

import { settingsHubRows, type SettingsHubRow } from '@/components/settings/hub';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { useProfileApi } from '@/components/settings/use-profile-api';
import type { SettingsIconId } from '@/lib/settings-items';

export default function SettingsScreen() {
  return (
    <RequireAuth>
      <SettingsHub />
    </RequireAuth>
  );
}

// One entry per settings row icon; the type makes a missing entry a compile
// error. Append one line per new row.
const HUB_ICONS: Record<SettingsIconId, LucideIcon> = {
  profile: UserRound,
  ai: Bot,
  requests: UserPlus,
  approvals: ShieldCheck,
  machines: Server,
  connections: KeyRound,
  integrations: Plug,
};

function hubIcon(icon: SettingsIconId, scheme: 'light' | 'dark') {
  const Icon = HUB_ICONS[icon];
  return <Icon size={22} color={ICON[scheme]} />;
}

function UserCard({ profile }: { profile: MyProfile | null }) {
  const me = useAuthStore((state) => state.me);
  const name = profile?.name ?? me?.name ?? '';
  if (name === '') {
    return null;
  }
  const handle = profile?.handle ?? null;
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Avatar id={profile?.id ?? me?.id ?? 'me'} name={name} size={52} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
          {handle === null ? (me?.email ?? '') : `@${handle}`}
        </Text>
      </View>
    </View>
  );
}

function SettingsRow({ row, onPress }: { row: SettingsHubRow; onPress: () => void }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 active:bg-surface-raised"
    >
      <View testID={row.iconTestId}>{hubIcon(row.icon, scheme)}</View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {row.title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
          {row.subtitle}
        </Text>
      </View>
      <ChevronRight size={18} color={MUTED_FOREGROUND[scheme]} />
    </Pressable>
  );
}

function SettingsHub() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useProfileApi();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const rows = settingsHubRows();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void api
        .getMe()
        .then((me) => {
          if (active) {
            setProfile(me);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            // The name still comes from the session; the handle line stays
            // empty rather than blocking the hub on a profile failure.
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [api]),
  );

  return (
    <SettingsScreenShell
      title="Settings"
      subtitle="Your profile and your AIs."
      onBack={() => router.back()}
    >
      <View className="gap-3">
        {loading ? (
          <View className="items-center py-4">
            <ActivityIndicator color={ACCENT[scheme]} />
          </View>
        ) : (
          <UserCard profile={profile} />
        )}
        <View className="gap-1">
          {rows.map((row) => (
            <SettingsRow key={row.id} row={row} onPress={() => router.push(row.href)} />
          ))}
        </View>
      </View>
    </SettingsScreenShell>
  );
}
