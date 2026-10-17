import { Effect } from 'effect';
import type { ApiFailure } from '@/lib/effect/errors';
import type { GroupDetail, TopicMember } from '@/lib/api';
import { EntityAvatar } from '../EntityAvatar';
import { StateMessage } from '../ui/state-message';
import { RemoveMemberButton } from './TopicActionButtons';
import { LoadFailed, RefreshFailed } from './TopicListNotices';

type GroupMemberRow = GroupDetail['members'][number];

export type MembersState = {
  status: 'loading' | 'ready' | 'error';
  members: TopicMember[];
  message: string;
};

/**
 * The Members section: the private topic's list with Remove for managers, or
 * the "all members can read" line for a public one. Leave moved to the panel's
 * bottom group (T-1797). The add pickers moved to the one "Add people or AIs"
 * dialog (T-1784).
 */
export function TopicMembersSection({
  isPrivate,
  state,
  groupMembers,
  allMembersText,
  me,
  isManager,
  onRetry,
  removeMember,
  onError,
}: {
  isPrivate: boolean;
  state: MembersState;
  groupMembers: GroupMemberRow[];
  allMembersText: string;
  me: string | undefined;
  isManager: boolean;
  onRetry: () => void;
  removeMember: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="Members" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>
      {isPrivate ? (
        <>
          {state.status === 'loading' && (
            <StateMessage kind="loading" size="inline" title="Loading…" />
          )}
          {state.status === 'error' && <LoadFailed message={state.message} onRetry={onRetry} />}
          {state.status === 'ready' && state.message !== '' && (
            <RefreshFailed message={state.message} onRetry={onRetry} />
          )}
          {state.status === 'ready' &&
            state.members.map((member) => {
              const detail = groupMembers.find((item) => item.userId === member.userId);
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                >
                  <EntityAvatar
                    person={{
                      userId: member.userId,
                      name: member.name,
                      avatarUrl: detail?.avatarUrl,
                    }}
                    size={32}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    {member.name}
                    {member.userId === me && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  {detail?.role !== undefined && detail.role !== 'member' && (
                    <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                      {detail.role}
                    </span>
                  )}
                  {isManager && member.userId !== me && (
                    <RemoveMemberButton member={member} remove={removeMember} onError={onError} />
                  )}
                </div>
              );
            })}
        </>
      ) : (
        <p className="px-2 text-[13px] text-muted-foreground">{allMembersText}</p>
      )}
    </section>
  );
}
