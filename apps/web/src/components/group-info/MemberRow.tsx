import { Crown, MoreVertical, Shield, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { useState } from 'react';
import type { GroupMember } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from '../ConfirmDialog';
import { EntityAvatar } from '../EntityAvatar';
import { HandleSuffix } from '../HandleSuffix';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';

/**
 * One member row of the Members page (T-1508, WebMembers.dc.html): the avatar
 * and the name, the owner or admin shown as an icon and never a word, the
 * custom role tags on a second line under the name, and a ⋮ menu with Make
 * admin / Remove admin (the owner only, T-1741), Make owner (the owner only,
 * never on yourself) and Remove (managers only, never on the owner or yourself).
 */
export function MemberRow({
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
      <EntityAvatar person={member} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[14px]">
            {member.name} <HandleSuffix handle={member.handle} />
          </span>
          {member.role === 'owner' && (
            <Crown className="size-[14px] shrink-0 text-[#e5b84b]" role="img" aria-label="Owner" />
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

/** A small monospace chip for a custom role name. */
function RoleChip({ name }: { name: string }) {
  return (
    <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
      {name}
    </span>
  );
}
