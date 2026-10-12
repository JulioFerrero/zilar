import { Effect } from 'effect';
import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router';
import { personSeed } from '@zilar/chat-core';
import type { GroupDetail, GroupRole } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { Avatar } from './Avatar';
import { HandleSuffix } from './HandleSuffix';
import { PanelFailure, apiStep, messageOf } from './panels/groupPanelOps';
import { roleLabel } from './panels/role-label';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog } from './ui/dialog';

/**
 * Group members (T-1183): role chips, Remove for owners and admins (never on
 * the owner or yourself), Add members from the contacts, and Leave group for
 * non-owners. Errors show inline; the server enforces the same rules.
 */
export function GroupMembersSection({
  chatId,
  info,
  me,
  rolesByUser,
  onClose,
}: {
  chatId: string;
  info: GroupDetail;
  me: string | undefined;
  rolesByUser: Map<string, GroupRole[]>;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const contacts = useChatSelector((s) => s.contacts);
  const ownJid = useChatSelector((s) => s.me?.jid);
  const meRole = info.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const isOwner = meRole === 'owner';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [transferConfirmingId, setTransferConfirmingId] = useState<string | undefined>(undefined);
  const [leaveConfirming, setLeaveConfirming] = useState(false);

  // One action for the section, as in GroupRolesSection: buttons disable while
  // a change runs, and the last failure stays visible.
  const [changeState, runChange] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change,
  );
  const busy = isWaiting(changeState);
  const errorMessage = messageOf(changeState) ?? '';

  const memberIds = new Set(info.members.map((member) => member.userId));
  const addable = contacts.filter((contact) => !memberIds.has(contact.userId));
  // T-1209: member balls are seeded by the bare JID, derived from the user
  // id the way the mention builder does (the domain from my own JID); the
  // members list carries no JID, so this is the only form available here.
  const domain = ownJid?.slice(ownJid.indexOf('@') + 1);
  const seedFor = (userId: string): string =>
    domain === undefined || domain === '' ? userId : personSeed(userId, domain);

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

  const removeMember = (userId: string): void => {
    run(
      () => storeApi.getState().removeGroupMember(chatId, userId),
      'Could not remove the member.',
      () => setConfirmingId(undefined),
    );
  };

  // T-1190: the owner hands the group to another member. The detail refreshes,
  // so the panel repaints with the caller as an admin and Leave group appears.
  const transferOwner = (userId: string): void => {
    run(
      () => storeApi.getState().transferGroupOwner(chatId, userId),
      'Could not hand over the group.',
      () => setTransferConfirmingId(undefined),
    );
  };

  const leaveGroup = (): void => {
    run(
      () => storeApi.getState().leaveChannel(chatId),
      'Could not leave the group.',
      () => {
        onClose();
        navigate('/');
      },
    );
  };

  return (
    <section aria-label="Members" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>

      {info.members.map((member) => {
        const label = roleLabel(member.role);
        // The fresh roles list wins over the group detail's snapshot (T-0116).
        const chipRoles = rolesByUser.get(member.userId) ?? member.roles ?? [];
        const removable = isManager && member.role !== 'owner' && member.userId !== me;
        const transferable = isOwner && member.userId !== me;
        const confirming = confirmingId === member.userId;
        const transferConfirming = transferConfirmingId === member.userId;
        return (
          <Fragment key={member.userId}>
            <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
              <Avatar
                id={seedFor(member.userId)}
                name={member.name}
                size={32}
                avatarUrl={member.avatarUrl}
              />
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {member.name} <HandleSuffix handle={member.handle} />
              </span>
              {chipRoles.map((role) => (
                <RoleChip key={role.id} name={role.name} />
              ))}
              {label !== undefined && <RoleChip name={label} />}
              {transferable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Make ${member.name} the owner`}
                  disabled={busy}
                  onClick={() => setTransferConfirmingId(member.userId)}
                >
                  Make owner
                </Button>
              )}
              {removable && (
                <Button
                  type="button"
                  variant={confirming ? 'destructive' : 'ghost'}
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={
                    confirming ? `Confirm removing ${member.name}` : `Remove ${member.name}`
                  }
                  disabled={busy}
                  onClick={() =>
                    confirming ? removeMember(member.userId) : setConfirmingId(member.userId)
                  }
                >
                  Remove
                </Button>
              )}
              {confirming && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingId(undefined)}
                >
                  Cancel
                </Button>
              )}
            </div>
            {transferConfirming && (
              <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
                <span className="text-[13px] text-muted-foreground">
                  Make {member.name} the owner? You become an admin.
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="shrink-0"
                  aria-label={`Confirm making ${member.name} the owner`}
                  disabled={busy}
                  onClick={() => transferOwner(member.userId)}
                >
                  Make owner
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setTransferConfirmingId(undefined)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </Fragment>
        );
      })}
      {isManager && addable.length > 0 && (
        <div className="px-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="rounded-full px-4"
            onClick={() => setPickerOpen(true)}
          >
            Add members
          </Button>
        </div>
      )}
      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
      {isOwner && (
        <p className="px-2 text-[13px] text-muted-foreground">
          To leave, make someone else the owner first.
        </p>
      )}
      {meRole !== undefined && meRole !== 'owner' && (
        <div className="flex items-center gap-2 px-2 pt-1">
          <Button
            type="button"
            variant={leaveConfirming ? 'destructive' : 'outline'}
            size="lg"
            className="rounded-full px-4"
            disabled={busy}
            onClick={leaveConfirming ? leaveGroup : () => setLeaveConfirming(true)}
          >
            {leaveConfirming ? 'Leave' : 'Leave group'}
          </Button>
          {leaveConfirming && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={busy}
              onClick={() => setLeaveConfirming(false)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={pickerOpen}
        onClose={closePicker}
        title="Add members"
        ariaLabel="Add members"
        size="sm"
        actions={
          <>
            <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={closePicker}>
              Cancel
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={selected.length === 0 || busy}
              onClick={addMembers}
            >
              Add
            </Button>
          </>
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
              <Avatar
                id={contact.jid}
                name={contact.name}
                size={28}
                avatarUrl={contact.avatarUrl}
              />
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

/** A small monospace chip for a custom role name or a member's role. */
function RoleChip({ name }: { name: string }) {
  return (
    <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
      {name}
    </span>
  );
}
