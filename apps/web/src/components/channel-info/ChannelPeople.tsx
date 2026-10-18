import { Crown, MoreVertical, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import type { GroupMember } from '@/lib/api';
import type { ApiFailure } from '@/lib/effect/errors';
import { FieldError } from '../ais/AiPageShell';
import { EntityAvatar } from '../EntityAvatar';
import { failureText } from '../panels/channelPanelOps';
import { SectionLabel } from '../ui/card';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';
import { SearchField } from '../ui/search-field';
import { StateMessage } from '../ui/state-message';

/** The owner and admin as icons, never words (WebChannelSubscribers.dc.html). */
function RoleIcon({ role }: { role: GroupMember['role'] }) {
  if (role === 'owner') {
    return <Crown className="size-[14px] shrink-0 text-[#e5b84b]" role="img" aria-label="Owner" />;
  }
  if (role === 'admin') {
    return (
      <ShieldCheck
        className="size-[14px] shrink-0 text-muted-foreground"
        role="img"
        aria-label="Admin"
      />
    );
  }
  return null;
}

/**
 * The Admins page (T-1519): one rounded list of who posts in the channel, the
 * owner and admins as icons. Subscribers only get this slice from the server,
 * so their loading, failure and empty states are kept from the old panel.
 */
export function ChannelAdminsPage({
  admins,
  loading,
  failure,
}: {
  admins: GroupMember[];
  loading: boolean;
  failure: ApiFailure | undefined;
}) {
  return (
    <section aria-label="Admins" className="flex flex-col gap-1">
      {loading && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {failure !== undefined && (
        <FieldError>{failureText(failure, 'Could not load the admins.')}</FieldError>
      )}
      {!loading && failure === undefined && admins.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">Only admins can post here.</p>
      )}
      {admins.length > 0 && (
        <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
          {admins.map((member) => (
            <div key={member.userId} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <EntityAvatar person={member} size={36} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate text-[14px]">{member.name}</span>
                <RoleIcon role={member.role} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The Subscribers page (T-1519): a search field, the admins then the rest, each
 * row carrying its role icon, and a ⋮ menu for the owner with Make admin or
 * Remove admin — the word keys and role chips are gone (WebChannelSubscribers).
 */
export function ChannelSubscribersPage({
  members,
  me,
  isOwner,
  roleBusy,
  flipRole,
  roleError,
}: {
  members: GroupMember[];
  me: string;
  isOwner: boolean;
  roleBusy: boolean;
  flipRole: (input: { userId: string; role: 'admin' | 'member' }) => void;
  roleError: string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (member: GroupMember): boolean =>
    needle === '' || member.name.toLowerCase().includes(needle);
  const admins = members.filter((member) => member.role !== 'member' && matches(member));
  const subscribers = members.filter((member) => member.role === 'member' && matches(member));

  return (
    <section aria-label="Subscribers" className="flex flex-col gap-2">
      <SearchField
        aria-label="Search subscribers"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <SectionLabel>Admins</SectionLabel>
      <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
        {admins.map((member) => (
          <SubscriberRow
            key={member.userId}
            member={member}
            me={me}
            isOwner={isOwner}
            busy={roleBusy}
            flipRole={flipRole}
          />
        ))}
      </div>

      <SectionLabel>Subscribers</SectionLabel>
      <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
        {subscribers.map((member) => (
          <SubscriberRow
            key={member.userId}
            member={member}
            me={me}
            isOwner={isOwner}
            busy={roleBusy}
            flipRole={flipRole}
          />
        ))}
      </div>

      {roleError !== '' && <FieldError>{roleError}</FieldError>}
    </section>
  );
}

/** One subscribers row: avatar, name, role icon, and the owner's ⋮ menu. */
function SubscriberRow({
  member,
  me,
  isOwner,
  busy,
  flipRole,
}: {
  member: GroupMember;
  me: string;
  isOwner: boolean;
  busy: boolean;
  flipRole: (input: { userId: string; role: 'admin' | 'member' }) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canFlip = isOwner && member.userId !== me;
  const isAdmin = member.role === 'admin';

  return (
    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
      <EntityAvatar person={member} size={36} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-[14px]">{member.name}</span>
        <RoleIcon role={member.role} />
      </span>
      {canFlip && (
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`Options for ${member.name}`}
          align="end"
          trigger={
            <IconButton aria-label={`Options for ${member.name}`} disabled={busy}>
              <MoreVertical className="size-4" aria-hidden="true" />
            </IconButton>
          }
        >
          {isAdmin ? (
            <MenuItem
              icon={ShieldOff}
              onSelect={() => {
                setMenuOpen(false);
                flipRole({ userId: member.userId, role: 'member' });
              }}
            >
              Remove admin
            </MenuItem>
          ) : (
            <MenuItem
              icon={ShieldCheck}
              onSelect={() => {
                setMenuOpen(false);
                flipRole({ userId: member.userId, role: 'admin' });
              }}
            >
              Make admin
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  );
}
