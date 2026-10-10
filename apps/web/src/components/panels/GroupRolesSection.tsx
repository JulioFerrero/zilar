import { Effect } from 'effect';
import { useState } from 'react';
import type { GroupRole } from '@/lib/api';
import { createGroupRole, deleteGroupRole, renameGroupRole, setGroupRoleMembers } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { FieldError } from '../ais/AiPageShell';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { StateMessage } from '../ui/state-message';
import { TextInput } from '../ui/text-input';
import { PanelFailure, apiStep, messageOf } from './groupPanelOps';
import type { RolesView } from './groupPanelOps';

/**
 * Custom group roles for managers (T-0116): create, rename, delete, and
 * assign with a member multi-select. A role grants private-topic access and
 * approver rights in the topics it is attached to — picked per topic in
 * the topic panel, not here.
 */
export function GroupRolesSection({
  groupId,
  members,
  rolesState,
  onReload,
}: {
  groupId: string;
  members: Array<{ userId: string; name: string; avatarUrl?: string | undefined }>;
  rolesState: RolesView;
  onReload: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [assigningId, setAssigningId] = useState<string | undefined>(undefined);
  // One action for the section, as before: every role button is disabled
  // while a change runs, and the roles reload after each success.
  const [changeState, runChange] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change.pipe(Effect.tap(() => Effect.sync(onReload))),
  );
  const busy = isWaiting(changeState);
  const errorMessage = messageOf(changeState) ?? '';

  const create = (): void => {
    const name = newName.trim();
    runChange(
      name === ''
        ? Effect.fail(new PanelFailure({ message: 'Enter a role name.' }))
        : apiStep(
            () => createGroupRole(groupId, name.slice(0, 30)),
            'Could not save the roles.',
          ).pipe(Effect.tap(() => Effect.sync(() => setNewName('')))),
    );
  };

  const rename = (roleId: string): void => {
    const name = renameValue.trim();
    runChange(
      name === ''
        ? Effect.fail(new PanelFailure({ message: 'Enter a role name.' }))
        : apiStep(
            () => renameGroupRole(groupId, roleId, name.slice(0, 30)),
            'Could not save the roles.',
          ).pipe(Effect.tap(() => Effect.sync(() => setRenamingId(undefined)))),
    );
  };

  const remove = (roleId: string): void => {
    runChange(
      apiStep(() => deleteGroupRole(groupId, roleId), 'Could not save the roles.').pipe(
        Effect.tap(() => Effect.sync(() => setConfirmingId(undefined))),
      ),
    );
  };

  const toggleHolder = (role: GroupRole, userId: string): void => {
    const held = role.members.some((holder) => holder.userId === userId);
    const userIds = held
      ? role.members.filter((holder) => holder.userId !== userId).map((holder) => holder.userId)
      : [...role.members.map((holder) => holder.userId), userId];
    runChange(
      apiStep(
        () => setGroupRoleMembers(groupId, role.id, userIds),
        'Could not save the roles.',
      ).pipe(Effect.asVoid),
    );
  };

  return (
    <section aria-label="Roles" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Roles</h2>
      {rolesState.status === 'loading' && (
        <StateMessage kind="loading" size="inline" title="Loading…" />
      )}
      {rolesState.status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{rolesState.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={onReload}
          >
            Retry
          </Button>
        </div>
      )}
      {rolesState.status === 'ready' && rolesState.roles.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No roles yet. Roles grant private-topic access and approver rights.
        </p>
      )}
      {rolesState.status === 'ready' &&
        rolesState.roles.map((role) => {
          const renaming = renamingId === role.id;
          const confirming = confirmingId === role.id;
          const assigning = assigningId === role.id;
          return (
            <div key={role.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
              <div className="flex items-center gap-2">
                {renaming ? (
                  <TextInput
                    aria-label={`Rename ${role.name}`}
                    value={renameValue}
                    maxLength={30}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="min-w-0 flex-1"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {role.name} ({role.members.length})
                  </span>
                )}
                {renaming ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => rename(role.id)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRenamingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : confirming ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Confirm deleting ${role.name}`}
                      disabled={busy}
                      onClick={() => remove(role.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Assign ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setAssigningId(assigning ? undefined : role.id)}
                    >
                      Assign
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => {
                        setRenameValue(role.name);
                        setRenamingId(role.id);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setConfirmingId(role.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              {assigning && !renaming && !confirming && (
                <div className="flex flex-col gap-1 pl-1">
                  {members.map((member) => {
                    const checked = role.members.some((holder) => holder.userId === member.userId);
                    return (
                      <label
                        key={member.userId}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-list-hover"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={busy}
                          label={`${member.name} holds ${role.name}`}
                          onCheckedChange={() => toggleHolder(role, member.userId)}
                        />
                        <Avatar
                          id={member.userId}
                          name={member.name}
                          size={28}
                          avatarUrl={member.avatarUrl}
                        />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      <div className="mt-1 flex items-center gap-2 px-2">
        <TextInput
          aria-label="New role name"
          value={newName}
          maxLength={30}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="e.g. Designers"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="lg"
          className="shrink-0 rounded-full px-4"
          disabled={busy || newName.trim() === ''}
          onClick={() => create()}
        >
          {busy ? 'Saving…' : 'Add role'}
        </Button>
      </div>
      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
    </section>
  );
}
