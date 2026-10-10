import { Effect } from 'effect';
import type { ApiFailure } from '@/lib/effect/errors';
import type { GroupDetail, TopicMember } from '@/lib/api';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { AddMemberButton, RemoveMemberButton } from './TopicActionButtons';
import { LoadFailed, PickerToggle, RefreshFailed } from './TopicListNotices';

type GroupMemberRow = GroupDetail['members'][number];

export type MembersState = {
  status: 'loading' | 'ready' | 'error';
  members: TopicMember[];
  message: string;
};

/**
 * The Members section: the private topic's list with Add/Remove for managers
 * and Leave for a member, or the "all members can read" line for a public one.
 */
export function TopicMembersSection({
  isPrivate,
  state,
  groupMembers,
  addableMembers,
  allMembersText,
  me,
  isManager,
  iAmMember,
  pickerOpen,
  leaving,
  onPickerOpenChange,
  onRetry,
  onLeave,
  removeMember,
  addMember,
  onError,
}: {
  isPrivate: boolean;
  state: MembersState;
  groupMembers: GroupMemberRow[];
  addableMembers: GroupMemberRow[];
  allMembersText: string;
  me: string | undefined;
  isManager: boolean;
  iAmMember: boolean;
  pickerOpen: boolean;
  leaving: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onLeave: () => void;
  removeMember: (userId: string) => Effect.Effect<void, ApiFailure>;
  addMember: (userId: string) => Effect.Effect<void, ApiFailure>;
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
                  <Avatar
                    id={member.userId}
                    name={member.name}
                    size={32}
                    avatarUrl={detail?.avatarUrl}
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
          {isManager && addableMembers.length > 0 && (
            <PickerToggle
              open={pickerOpen}
              openLabel="Add people"
              onOpen={() => onPickerOpenChange(true)}
              onCancel={() => onPickerOpenChange(false)}
            >
              {addableMembers.map((member) => (
                <AddMemberButton
                  key={member.userId}
                  member={member}
                  add={addMember}
                  onError={onError}
                />
              ))}
            </PickerToggle>
          )}
          {!isManager && iAmMember && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="mx-2 self-start rounded-full px-4"
              disabled={leaving}
              onClick={onLeave}
            >
              {leaving ? 'Leaving…' : 'Leave topic'}
            </Button>
          )}
        </>
      ) : (
        <p className="px-2 text-[13px] text-muted-foreground">{allMembersText}</p>
      )}
    </section>
  );
}
