import { Effect } from 'effect';
import { useState } from 'react';
import {
  getTopic,
  listGroupRoles,
  type ApproverRole,
  type GroupRole,
  type TopicRole,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from '../ais/AiPageShell';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { failInline, textOf } from './topic-failure';
import { storeCall, type PanelStatus } from './topicPanelOps';

/**
 * The topic's roles (T-0116): attached roles with holder counts next to the
 * people list, and the approver select ("Owner and admins only" or one
 * role). Managers edit; everyone else reads. Saving goes through the
 * store so the chat row refreshes. Saves stay one action for the section:
 * each save sends the whole role list, so two saves at once would drop one.
 */
export function TopicRolesSection({
  chatId,
  topicId,
  groupId,
  isManager,
}: {
  chatId: string;
  topicId: string;
  groupId: string;
  isManager: boolean;
}) {
  const storeApi = useChatStoreApi();
  const [rolesState, setRolesState] = useState<{
    status: PanelStatus;
    roles: TopicRole[];
    approverRole: ApproverRole | null;
    message: string;
  }>({ status: 'loading', roles: [], approverRole: null, message: '' });
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // The topic and the group's roles load side by side; a failure shows the
  // inline error with Retry.
  const loadRoles = Effect.sync(() =>
    setRolesState({ status: 'loading', roles: [], approverRole: null, message: '' }),
  ).pipe(
    Effect.andThen(
      Effect.all([fromApi(() => getTopic(topicId)), fromApi(() => listGroupRoles(groupId))], {
        concurrency: 'unbounded',
      }),
    ),
    Effect.tap(([topic, roles]) =>
      Effect.sync(() => {
        setGroupRoles(roles);
        setRolesState({
          status: 'ready',
          roles: topic.roles ?? [],
          approverRole: topic.approverRole ?? null,
          message: '',
        });
      }),
    ),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() =>
        setRolesState({
          status: 'error',
          roles: [],
          approverRole: null,
          message: textOf(failure, 'Could not load the roles.'),
        }),
      ),
    ),
  );
  const [, refreshRoles] = useQuery(() => loadRoles, [topicId, groupId]);

  // A second click while a save waits is dropped (mode 'ignore').
  const [saveState, saveRoles] = useAction(
    (input: { roleIds: string[]; approverRoleId: string | null }) =>
      Effect.sync(() => setErrorMessage('')).pipe(
        Effect.andThen(storeCall(() => storeApi.getState().setTopicRoles(chatId, input))),
        Effect.andThen(loadRoles),
        Effect.andThen(Effect.sync(() => setPickerOpen(false))),
        Effect.catchTag('ApiFailure', failInline(setErrorMessage, 'Could not save the roles.')),
      ),
  );
  const busy = isWaiting(saveState);

  const save = (roleIds: string[], approverRoleId: string | null): void =>
    saveRoles({ roleIds, approverRoleId });

  const toggleRole = (roleId: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    const attached = rolesState.roles.some((role) => role.id === roleId);
    const roleIds = attached
      ? rolesState.roles.filter((role) => role.id !== roleId).map((role) => role.id)
      : [...rolesState.roles.map((role) => role.id), roleId];
    save(roleIds, rolesState.approverRole?.id ?? null);
  };

  const pickApprover = (value: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    save(
      rolesState.roles.map((role) => role.id),
      value === '' ? null : value,
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
            onClick={() => refreshRoles()}
          >
            Retry
          </Button>
        </div>
      )}
      {rolesState.status === 'ready' && (
        <>
          {rolesState.roles.length === 0 ? (
            <p className="px-2 text-[13px] text-muted-foreground">
              No roles here yet — only the people above can see this topic.
            </p>
          ) : (
            rolesState.roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {role.name} ({role.memberCount})
                </span>
                {isManager && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove ${role.name} from the topic`}
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => void toggleRole(role.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))
          )}
          {isManager && (
            <>
              {pickerOpen ? (
                <div className="mt-1 flex flex-col gap-1 px-2">
                  {groupRoles
                    .filter((role) => !rolesState.roles.some((item) => item.id === role.id))
                    .map((role) => (
                      <Button
                        key={role.id}
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggleRole(role.id)}
                        className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
                      >
                        <span className="min-w-0 flex-1 truncate">{role.name}</span>
                        <span className="text-[12px] text-muted-foreground">
                          {role.members.length}
                        </span>
                      </Button>
                    ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setPickerOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                groupRoles.some(
                  (role) => !rolesState.roles.some((item) => item.id === role.id),
                ) && (
                  <Button
                    type="button"
                    size="lg"
                    className="mx-2 self-start rounded-full px-4"
                    onClick={() => setPickerOpen(true)}
                  >
                    Add roles
                  </Button>
                )
              )}
              <label className="mt-1 flex flex-col gap-1 px-2">
                <span className="text-[13px] font-medium text-muted-foreground">Approvers</span>
                <select
                  aria-label="Approvers"
                  value={rolesState.approverRole?.id ?? ''}
                  disabled={busy}
                  onChange={(event) => pickApprover(event.target.value)}
                  className="well-surface rounded-[10px] px-3 py-2 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <option value="">Owner and admins only</option>
                  {rolesState.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {!isManager && rolesState.approverRole !== null && (
            <p className="px-2 text-[13px] text-muted-foreground">
              Approvers: {rolesState.approverRole.name}
            </p>
          )}
          {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
        </>
      )}
    </section>
  );
}
