import { Effect } from 'effect';
import {
  Crown,
  Link,
  MoreVertical,
  Shield,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import type { GroupDetail, GroupMember, GroupRole } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { ConfirmDialog } from './ConfirmDialog';
import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { PanelFailure, apiStep, messageOf } from './panels/groupPanelOps';
import { PersonLink } from './personLink';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { ListRow } from './ui/list-row';
import { Menu, MenuItem } from './ui/menu';
import { SearchField } from './ui/search-field';

export function GroupMembersSection({
  chatId,
  info,
  me,
  rolesByUser,
  onOpenLinks,
  openPickerOnMount = false,
}: {
  chatId: string;
  info: GroupDetail;
  me: string | undefined;
  rolesByUser: Map<string, GroupRole[]>;
  onOpenLinks: () => void;
  openPickerOnMount?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const contacts = useChatSelector((s) => s.contacts);
  const meRole = info.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const isOwner = meRole === 'owner';

  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(openPickerOnMount);
  const [selected, setSelected] = useState<string[]>([]);

  const [changeState, runChange] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change,
  );
  const busy = isWaiting(changeState);
  const errorMessage = messageOf(changeState) ?? '';

  const memberIds = new Set(info.members.map((member) => member.userId));
  const addable = contacts.filter((contact) => !memberIds.has(contact.userId));

  const run = (call: () => Promise<void>, fallback: string, after?: () => void): void =>
    runChange(apiStep(call, fallback).pipe(Effect.tap(() => Effect.sync(() => after?.()))));

  const toggle = (userId: string): void => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setSelected([]);
  };

  const addMembers = (): void => {
    run(
      () => storeApi.getState().addGroupMembers(chatId, selected),
      'Could not add the members.',
      closePicker,
    );
  };

  const needle = query.trim().toLowerCase();
  const visibleMembers =
    needle === ''
      ? info.members
      : info.members.filter(
          (member) =>
            member.name.toLowerCase().includes(needle) ||
            (member.handle ?? '').toLowerCase().includes(needle),
        );

  return (
    <section aria-label="Members" className="flex flex-col gap-2">
      <SearchField
        aria-label="Search members"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {isManager && (
        <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
          <ListRow
            icon={<UserPlus className="size-4" aria-hidden="true" />}
            title="Add members"
            onClick={() => setPickerOpen(true)}
          />
          <ListRow
            icon={<Link className="size-4" aria-hidden="true" />}
            title="Invite with a link"
            onClick={onOpenLinks}
          />
        </div>
      )}

      <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
        {visibleMembers.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            roles={rolesByUser.get(member.userId) ?? member.roles ?? []}
            me={me}
            chatId={chatId}
            isManager={isManager}
            isOwner={isOwner}
            busy={busy}
            run={run}
          />
        ))}
      </div>

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

      <Dialog
        open={pickerOpen}
        onClose={closePicker}
        title="Add members"
        ariaLabel="Add members"
        size="sm"
        busy={busy}
        actions={
          <Button
            type="button"
            size="lg"
            disabled={selected.length === 0 || busy}
            onClick={addMembers}
          >
            Add
          </Button>
        }
      >
        <div className="mt-3">
          {addable.map((contact) => (
            <label
              key={contact.userId}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
            >
              <Checkbox
                checked={selected.includes(contact.userId)}
                onCheckedChange={() => toggle(contact.userId)}
              />
              <EntityAvatar person={contact} size={28} />
              <span className="truncate text-[15px]">
                {contact.name} <HandleSuffix handle={contact.handle} />
              </span>
            </label>
          ))}
        </div>
      </Dialog>
    </section>
  );
}

function MemberRow({
  member,
  roles,
  me,
  chatId,
  isManager,
  isOwner,
  busy,
  run,
}: {
  member: GroupMember;
  roles: ReadonlyArray<{ id: string; name: string }>;
  me: string | undefined;
  chatId: string;
  isManager: boolean;
  isOwner: boolean;
  busy: boolean;
  run: (call: () => Promise<void>, fallback: string, after?: () => void) => void;
}) {
  const storeApi = useChatStoreApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const transferable = isOwner && member.userId !== me;
  const roleChangeable = isOwner && member.userId !== me && member.role !== 'owner';
  const removable = isManager && member.role !== 'owner' && member.userId !== me;

  const transferOwner = (): void => {
    run(
      () => storeApi.getState().transferGroupOwner(chatId, member.userId),
      'Could not hand over the group.',
      () => setTransferOpen(false),
    );
  };

  const changeRole = (role: 'admin' | 'member'): void => {
    run(
      () => storeApi.getState().changeChannelRole(chatId, member.userId, role),
      'Could not change the member role.',
    );
  };

  const removeMember = (): void => {
    run(
      () => storeApi.getState().removeGroupMember(chatId, member.userId),
      'Could not remove the member.',
      () => setRemoveOpen(false),
    );
  };

  return (
    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
      <PersonLink
        target={{ userId: member.userId, handle: member.handle }}
        name={member.name}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px]"
      >
        <EntityAvatar person={member} size={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[14px]">
              {member.name} <HandleSuffix handle={member.handle} />
            </span>
            {member.role === 'owner' && (
              <Crown
                className="size-[14px] shrink-0 text-[#e5b84b]"
                role="img"
                aria-label="Owner"
              />
            )}
            {member.role === 'admin' && (
              <Shield
                className="size-[14px] shrink-0 text-muted-foreground"
                role="img"
                aria-label="Admin"
              />
            )}
          </span>
          {roles.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {roles.map((role) => (
                <RoleChip key={role.id} name={role.name} />
              ))}
            </span>
          )}
        </span>
      </PersonLink>

      {(transferable || removable) && (
        <>
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
            {roleChangeable && (
              <MenuItem
                icon={member.role === 'admin' ? ShieldOff : ShieldCheck}
                onSelect={() => {
                  setMenuOpen(false);
                  changeRole(member.role === 'admin' ? 'member' : 'admin');
                }}
              >
                {member.role === 'admin' ? 'Remove admin' : 'Make admin'}
              </MenuItem>
            )}
            {transferable && (
              <MenuItem
                icon={Crown}
                onSelect={() => {
                  setMenuOpen(false);
                  setTransferOpen(true);
                }}
              >
                Make owner
              </MenuItem>
            )}
            {removable && (
              <MenuItem
                icon={UserMinus}
                destructive
                onSelect={() => {
                  setMenuOpen(false);
                  setRemoveOpen(true);
                }}
              >
                Remove
              </MenuItem>
            )}
          </Menu>

          {transferOpen && (
            <ConfirmDialog
              title={`Make ${member.name} the owner?`}
              body="You become an admin."
              confirmLabel="Make owner"
              onCancel={() => setTransferOpen(false)}
              onConfirm={transferOwner}
            />
          )}
          {removeOpen && (
            <ConfirmDialog
              title={`Remove ${member.name}?`}
              body={`${member.name} will lose access to this group.`}
              confirmLabel="Remove"
              onCancel={() => setRemoveOpen(false)}
              onConfirm={removeMember}
            />
          )}
        </>
      )}
    </div>
  );
}

function RoleChip({ name }: { name: string }) {
  return (
    <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
      {name}
    </span>
  );
}
