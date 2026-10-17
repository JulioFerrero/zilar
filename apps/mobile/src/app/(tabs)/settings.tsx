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

// One entry per settings row icon; the type makes a missing entry a compile
// error. Append one line per new row.
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

// T-1899: the hub keeps the last profile it loaded, so opening Settings shows
// the card at once instead of a spinner while `GET /me` answers.
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
  // T-1329/T-1334: the ball is seeded by the display name; the picture shows
  // from the session's cached profile while `GET /me` loads, then from the
  // profile. The email is the profile's, the same source the own profile
  // screen shows, so the line is never blank while the session loads.
  const email = profile?.email ?? me?.email ?? '';
  if (name === '') {
    // T-1899: the placeholder keeps the card's height, so the menu below stays
    // where it is until the name arrives.
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
  // T-1899: the cached profile belongs to the account that loaded it, so a
  // different account signing in on this phone (after a sign-out or an expired
  // session) never sees it while `GET /me` is still in flight.
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
      // Leaving the tab interrupts a load still in flight, so a late answer
      // never lands on a hub that is no longer shown. The card already shows
      // the last profile or the session's name, so this only refreshes it.
      const load = Effect.runFork(
        fromApi(() => api.getMe()).pipe(
          Effect.tap((me) =>
            Effect.sync(() => {
              lastProfile = me;
              setProfile(me);
            }),
          ),
          // The name still comes from the session and the card keeps the last
          // profile it showed, so a failure changes nothing on screen.
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
        interruptFiber(count);
      };
    }, [contactsApi]),
  );

  // Signing out flips the session to `guest`; the chat store provider watches
  // that status and calls `store.stop()`, which ends the XMPP session
  // (`chat-store-provider.tsx`:124-130 → `coreStopStore` → `closeStore`).
  // Nothing else has to end it here; the login screen is the last step either way.
  const confirmSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().finally(() => {
      // T-1899: the cached profile survives visits to this tab, so it must not
      // survive a sign-out: the next account to sign in on this phone would
      // otherwise see the previous one's name and email on first open.
      lastProfile = null;
      setProfile(null);
      router.replace('/login');
    });
  }, [router, signOut]);

  return (
    <SettingsScreenShell title="Settings">
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
