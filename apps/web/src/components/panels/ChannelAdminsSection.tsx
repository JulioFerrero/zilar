import { Effect } from 'effect';
import type { GroupAi, GroupMember } from '@/lib/api';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from '../ais/AiPageShell';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { GroupAiRowView } from './GroupAiRowView';
import { type ChannelFailure, describeFailure, failureText, storeCall } from './channelPanelOps';
import { roleLabel } from './role-label';

/**
 * The channel's people: managers see the whole audience (names and roles, with
 * the owner's promote/demote buttons); subscribers see only who posts (the
 * admins slice). `GroupAiRow` sits here too, because the channel panel keeps
 * its own AI row (the shared-row dedup with GroupPanel is a separate task).
 */
export function ChannelAdminsSection({
  isManager,
  audience,
  isOwner,
  me,
  roleBusy,
  flipRole,
  roleError,
  adminsLoaded,
  adminsFailure,
  admins,
}: {
  isManager: boolean;
  audience: GroupMember[];
  isOwner: boolean;
  me: string;
  roleBusy: boolean;
  flipRole: (input: { userId: string; role: 'admin' | 'member' }) => void;
  roleError: string;
  adminsLoaded: boolean;
  adminsFailure: ApiFailure | undefined;
  admins: GroupMember[];
}) {
  return isManager ? (
    <section aria-label="Subscribers" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Subscribers</h2>
      {audience.map((member) => {
        const label = roleLabel(member.role);
        const canFlip = isOwner && member.userId !== me;
        return (
          <div
            key={member.userId}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
          >
            <Avatar id={member.userId} name={member.name} size={32} avatarUrl={member.avatarUrl} />
            <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
            {label !== undefined && (
              <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                {label}
              </span>
            )}
            {canFlip && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={
                  member.role === 'admin'
                    ? `Demote ${member.name} to subscriber`
                    : `Promote ${member.name} to admin`
                }
                className="shrink-0"
                disabled={roleBusy}
                onClick={() =>
                  flipRole({
                    userId: member.userId,
                    role: member.role === 'admin' ? 'member' : 'admin',
                  })
                }
              >
                {member.role === 'admin' ? 'Demote' : 'Promote'}
              </Button>
            )}
          </div>
        );
      })}
      {roleError !== '' && <FieldError>{roleError}</FieldError>}
    </section>
  ) : (
    <section aria-label="Admins" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Admins</h2>
      {!adminsLoaded && adminsFailure === undefined && (
        <StateMessage kind="loading" size="inline" title="Loading…" />
      )}
      {adminsFailure !== undefined && (
        <FieldError>{failureText(adminsFailure, 'Could not load the admins.')}</FieldError>
      )}
      {adminsLoaded && admins.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">Only admins can post here.</p>
      )}
      {admins.map((member) => (
        <div key={member.userId} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
          <Avatar id={member.userId} name={member.name} size={32} avatarUrl={member.avatarUrl} />
          <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * One AI row with its own Remove action, so two AIs can be removed at once; a
 * second click on the same row waits for the first.
 */
export function GroupAiRow({
  chatId,
  ai,
  addedBy,
  canRemove,
  confirming,
  onConfirm,
  onError,
}: {
  chatId: string;
  ai: GroupAi;
  addedBy: string;
  canRemove: boolean;
  confirming: boolean;
  onConfirm: (aiId: string | undefined) => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [removeState, removeAi] = useAction<void, void, ChannelFailure>(() =>
    Effect.sync(() => onError('')).pipe(
      Effect.andThen(
        storeCall(
          () => storeApi.getState().removeGroupAi(chatId, ai.aiId),
          'Could not remove the AI',
        ),
      ),
      Effect.tap(() => Effect.sync(() => onConfirm(undefined))),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => onError(describeFailure(failure, 'Could not remove the AI'))),
      ),
    ),
  );
  const removing = isWaiting(removeState);

  return (
    <GroupAiRowView
      ai={ai}
      addedBy={addedBy}
      canRemove={canRemove}
      confirming={confirming}
      busy={removing}
      removeLabel={`Remove ${ai.name} from the channel`}
      onAskRemove={() => onConfirm(ai.aiId)}
      onConfirmRemove={() => removeAi()}
      onCancel={() => onConfirm(undefined)}
    />
  );
}
