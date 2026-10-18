import { useAuth } from '@/auth/AuthProvider';
import { APPROVAL_BADGE_CAP } from '@/components/chatList/rowsSelector';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EntityAvatar } from '@/components/EntityAvatar';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Card, SectionLabel } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { useQuery } from '@/lib/effect/use-query';
import { listMyRoutines } from '@/lib/tools';
import { useContactRequestCount } from '@/lib/useContactRequestCount';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { usePendingApprovalCount } from '@/lib/usePendingApprovalCount';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_ITEMS,
  type SettingsGroup,
  type SettingsIconId,
  type SettingsItem,
} from '@zilar/chat-core';
import { fromApi } from '@zilar/client-core';
import { AsyncResult } from 'effect/reactivity';
import {
  ChevronRight,
  LogOut,
  Ban,
  Bell,
  FolderOpen,
  KeyRound,
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
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

function CountPill({ label, text }: { label: string; text: string }) {
  return (
    <span
      aria-label={label}
      className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
    >
      {text}
    </span>
  );
}

const WEB_SETTINGS_HREFS: ReadonlySet<string> = new Set([
  '/settings/profile',
  '/settings/requests',
  '/settings/contacts',
  '/settings/blocked',
  '/settings/devices',
  '/settings/notifications',
  '/settings/approvals',
  '/settings/routines',
  '/settings/machines',
  '/settings/connections',
  '/settings/integrations',
  '/settings/stickers',
  '/settings/folders',
]);

const SETTINGS_HUB_ICONS: Record<SettingsIconId, LucideIcon> = {
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

const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  account: 'Account',
  ais: 'AIs and tools',
  chats: 'Chats',
  server: 'Server',
};

interface WebSettingsGroup {
  group: SettingsGroup;
  label: string;
  rows: SettingsItem[];
}

function rowsFor(group: SettingsGroup): SettingsItem[] {
  return SETTINGS_ITEMS.filter((item) => item.group === group && WEB_SETTINGS_HREFS.has(item.href));
}

function webSettingsGroups(): WebSettingsGroup[] {
  return SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    label: SETTINGS_GROUP_LABELS[group],
    rows: rowsFor(group),
  })).filter((entry) => entry.rows.length > 0);
}

export function SettingsHubPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const storeApi = useChatStoreApi();
  const isServerOwner = useIsServerOwner();
  const incomingRequests = useContactRequestCount(true);
  const pendingApprovals = usePendingApprovalCount(true);
  const [routines] = useQuery(() => fromApi(() => listMyRoutines()), []);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const user = auth.user;

  const approvalsBadge =
    pendingApprovals !== null && pendingApprovals > 0
      ? pendingApprovals > APPROVAL_BADGE_CAP
        ? '9+'
        : String(pendingApprovals)
      : null;
  const runningRoutines = AsyncResult.isSuccess(routines)
    ? routines.value.filter((routine) => routine.status === 'active').length
    : 0;
  const routinesBadge = runningRoutines > 0 ? String(runningRoutines) : null;

  // The profile card already opens Profile, so the row is hidden from the Account card; a
  // group whose only row is hidden drops its empty card.
  const groups = webSettingsGroups()
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) => row.id !== 'profile' && (row.id !== 'integrations' || isServerOwner),
      ),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <SettingsShell title="Settings" onBack={() => navigate('/')}>
      <div className={SETTINGS_COLUMN}>
        {user !== undefined && (
          <Link
            to="/settings/profile"
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-raised"
          >
            <EntityAvatar me size={48} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] leading-5 font-semibold text-foreground">
                {user.name}
              </span>
              <span className="truncate text-[14px] text-muted-foreground">{user.email}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
          </Link>
        )}
        {groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-2">
            <SectionLabel>{group.label}</SectionLabel>
            <Card>
              {group.rows.map((row) => {
                const Icon = SETTINGS_HUB_ICONS[row.icon];
                const badge =
                  row.id === 'requests' && incomingRequests !== null && incomingRequests > 0 ? (
                    <CountPill
                      label={`${incomingRequests} incoming contact requests`}
                      text={incomingRequests > 9 ? '9+' : String(incomingRequests)}
                    />
                  ) : row.id === 'approvals' && approvalsBadge !== null ? (
                    <CountPill
                      label={`${approvalsBadge} pending approvals`}
                      text={approvalsBadge}
                    />
                  ) : row.id === 'routines' && routinesBadge !== null ? (
                    <CountPill label={`${routinesBadge} running routines`} text={routinesBadge} />
                  ) : undefined;
                return (
                  <ListRow
                    key={row.id}
                    icon={<Icon className="size-4" aria-hidden="true" />}
                    title={row.title}
                    chevron
                    href={row.href}
                    {...(badge === undefined ? {} : { trailing: badge })}
                  />
                );
              })}
            </Card>
          </div>
        ))}
        <Card>
          <ListRow
            icon={<LogOut className="size-4 text-danger" aria-hidden="true" />}
            title="Sign out"
            danger
            onClick={() => setConfirmingSignOut(true)}
          />
        </Card>
      </div>
      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out of Zilar in this browser?"
          body="You'll need to sign in again to chat."
          confirmLabel="Sign out"
          onConfirm={() => {
            setConfirmingSignOut(false);
            void storeApi.getState().signOut();
          }}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </SettingsShell>
  );
}
