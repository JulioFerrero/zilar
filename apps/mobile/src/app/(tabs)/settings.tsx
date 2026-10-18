import { useFocusEffect, useRouter } from 'expo-router';
import { Effect } from 'effect';
import {
  Ban,
  Bell,
  ChevronRight,
  FolderOpen,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Plug,
  Repeat,
  Server,
  ShieldCheck,
  Sticker,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { useAuthStore } from '@/auth/session';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Card, SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { DANGER, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { interruptFiber } from '@/lib/effect/timers';
import type { MyProfile } from '@/lib/profile-api';

import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { AppVersionRow } from '@/components/settings/app-version-row';
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

// The type makes a missing entry a compile error. Append one line per new row.
const HUB_ICONS: Record<SettingsIconId, LucideIcon> = {
  profile: UserRound,
  requests: UserPlus,
  contacts: Users,
  blocked: Ban,
  devices: MonitorSmartphone,
  approvals: ShieldCheck,
  routines: Repeat,
  machines: Server,
  connections: KeyRound,
  integrations: Plug,
  stickers: Sticker,
  folders: FolderOpen,
  notifications: Bell,
};

function hubIcon(icon: SettingsIconId) {
  const Icon = HUB_ICONS[icon];
  return <Icon size={18} color={ICON} />;
}

// Keeps the last loaded profile, so opening Settings shows the card at once instead of a spinner.
let lastProfile: MyProfile | null = null;

function ProfileHeaderCard({
  profile,
  onPress,
}: {
  profile: MyProfile | null;
  onPress: () => void;
}) {
  const me = useAuthStore((state) => state.me);
  const name = profile?.name ?? me?.name ?? '';
  const email = profile?.email ?? me?.email ?? '';
  if (name === '') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        onPress={onPress}
        className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-raised"
      >
        <View className="h-16 w-16 rounded-full bg-muted" />
        <View className="min-w-0 flex-1">
          <View className="h-4 w-32 rounded bg-surface-raised" />
          <View className="mt-0.5 h-3 w-44 rounded bg-surface-raised" />
        </View>
        <ChevronRight size={18} color={MUTED_FOREGROUND} />
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-raised"
    >
      <EntityAvatar person={profile ?? undefined} me={profile === null} size={64} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[18px] font-semibold text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[14px] text-muted-foreground">
          {email}
        </Text>
      </View>
      <ChevronRight size={18} color={MUTED_FOREGROUND} />
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
  return (
    <View className="gap-2">
      <SectionLabel>{group.label}</SectionLabel>
      <Card>
        {group.rows.map((row) => (
          <ListRow
            key={row.id}
            icon={<IconTile testID={row.iconTestId}>{hubIcon(row.icon)}</IconTile>}
            title={row.title}
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
  const { api } = useProfileApi();
  const { api: contactsApi } = useContactsApi();
  const me = useAuthStore((state) => state.me);
  // The cached profile belongs to the account that loaded it, so a different account signing in on this phone never sees it while `GET /me` is in flight.
  const [profile, setProfile] = useState<MyProfile | null>(() =>
    lastProfile !== null && lastProfile.id === me?.id ? lastProfile : null,
  );
  const [pendingRequests, setPendingRequests] = useState(0);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useAuthStore((state) => state.signOut);
  const groups = settingsHubGroups();

  useFocusEffect(
    useCallback(() => {
      const load = Effect.runFork(
        fromApi(() => api.getMe()).pipe(
          Effect.tap((me) =>
            Effect.sync(() => {
              lastProfile = me;
              setProfile(me);
            }),
          ),
          Effect.catch(() => Effect.void),
        ),
      );
      return () => {
        interruptFiber(load);
      };
    }, [api]),
  );

  useFocusEffect(
    useCallback(() => {
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
        interruptFiber(count);
      };
    }, [contactsApi]),
  );

  const confirmSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().finally(() => {
      // It must not survive a sign-out: the next account would otherwise see the previous one's name and email.
      lastProfile = null;
      setProfile(null);
      router.replace('/login');
    });
  }, [router, signOut]);

  return (
    <SettingsScreenShell title="Settings" tabName="settings">
      <View className="gap-6">
        <ProfileHeaderCard profile={profile} onPress={() => router.push('/me')} />
        {groups.map((group) => (
          <GroupCard
            key={group.group}
            group={group}
            pendingRequests={pendingRequests}
            onOpen={(href) => router.push(href)}
          />
        ))}
        {Platform.OS === 'android' ? (
          <View className="gap-2">
            <SectionLabel>This app</SectionLabel>
            <Card>
              <AppVersionRow />
            </Card>
          </View>
        ) : null}
        <Card>
          <ListRow
            icon={
              <IconTile>
                <LogOut size={18} color={DANGER} />
              </IconTile>
            }
            title="Sign out"
            accessibilityLabel="Sign out"
            onPress={() => {
              setSigningOut(false);
              setConfirmingSignOut(true);
            }}
          />
        </Card>
      </View>
      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out of Zilar on this phone?"
        message="You will need a sign-in code to get back in."
        confirmLabel="Sign out"
        busyLabel="Signing out…"
        busy={signingOut}
        onCancel={() => setConfirmingSignOut(false)}
        onConfirm={confirmSignOut}
        confirmAccessibilityLabel="Sign out"
        accessibilityLabel="Sign out of Zilar on this phone"
      />
    </SettingsScreenShell>
  );
}
