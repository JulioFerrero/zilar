import { useFocusEffect, useRouter } from 'expo-router';
import { Effect, Fiber } from 'effect';
import {
  Ban,
  ChevronRight,
  FolderOpen,
  KeyRound,
  Plug,
  Server,
  ShieldCheck,
  Sticker,
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
import { Card, SectionLabel } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { fromApi } from '@/lib/effect/api-effect';
import type { MyProfile } from '@/lib/profile-api';

import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { settingsHubGroups, type SettingsHubGroup } from '@/components/settings/hub';
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
  requests: UserPlus,
  blocked: Ban,
  approvals: ShieldCheck,
  machines: Server,
  connections: KeyRound,
  integrations: Plug,
  stickers: Sticker,
  folders: FolderOpen,
};

function hubIcon(icon: SettingsIconId, scheme: 'light' | 'dark') {
  const Icon = HUB_ICONS[icon];
  return <Icon size={18} color={ICON[scheme]} />;
}

function ProfileHeaderCard({
  profile,
  onPress,
}: {
  profile: MyProfile | null;
  onPress: () => void;
}) {
  const me = useAuthStore((state) => state.me);
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const name = profile?.name ?? me?.name ?? '';
  if (name === '') {
    return null;
  }
  const handle = profile?.handle ?? null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-raised"
    >
      <Avatar id={profile?.id ?? me?.id ?? 'me'} name={name} size={64} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[18px] font-semibold text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[14px] text-muted-foreground">
          {handle === null ? (me?.email ?? '') : `@${handle}`}
        </Text>
      </View>
      <ChevronRight size={18} color={MUTED_FOREGROUND[scheme]} />
    </Pressable>
  );
}

function GroupCard({
  group,
  pendingRequests,
  onOpen,
}: {
  group: SettingsHubGroup;
  pendingRequests: number;
  onOpen: (href: string) => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="gap-2">
      <SectionLabel>{group.label}</SectionLabel>
      <Card>
        {group.rows.map((row) => (
          <ListRow
            key={row.id}
            icon={<IconTile testID={row.iconTestId}>{hubIcon(row.icon, scheme)}</IconTile>}
            title={row.title}
            subtitle={row.subtitle}
            {...(row.id === 'requests' ? { count: pendingRequests } : {})}
            accessibilityLabel={row.accessibilityLabel}
            onPress={() => onOpen(row.href)}
          />
        ))}
      </Card>
    </View>
  );
}

function SettingsHub() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useProfileApi();
  const { api: contactsApi } = useContactsApi();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);
  const groups = settingsHubGroups();

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      // Leaving the tab interrupts a load still in flight, so a late answer
      // never lands on a hub that is no longer shown.
      const load = Effect.runFork(
        fromApi(() => api.getMe()).pipe(
          Effect.tap((me) =>
            Effect.sync(() => {
              setProfile(me);
              setLoading(false);
            }),
          ),
          // The name still comes from the session; the handle line stays
          // empty rather than blocking the hub on a profile failure.
          Effect.catch(() => Effect.sync(() => setLoading(false))),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(load));
      };
    }, [api]),
  );

  useFocusEffect(
    useCallback(() => {
      // The same source the requests screen counts: incoming plus outgoing.
      const count = Effect.runFork(
        fromApi(() => contactsApi.listContactRequests()).pipe(
          Effect.tap((list) =>
            Effect.sync(() => {
              setPendingRequests(list.incoming.length + list.outgoing.length);
            }),
          ),
          Effect.catch(() => Effect.sync(() => setPendingRequests(0))),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(count));
      };
    }, [contactsApi]),
  );

  return (
    <SettingsScreenShell title="Settings" subtitle="Your account, chats and AIs.">
      <View className="gap-6">
        {loading ? (
          <View className="items-center py-4">
            <ActivityIndicator color={ACCENT[scheme]} />
          </View>
        ) : (
          <ProfileHeaderCard profile={profile} onPress={() => router.push('/settings/profile')} />
        )}
        {groups.map((group) => (
          <GroupCard
            key={group.group}
            group={group}
            pendingRequests={pendingRequests}
            onOpen={(href) => router.push(href)}
          />
        ))}
      </View>
    </SettingsScreenShell>
  );
}
