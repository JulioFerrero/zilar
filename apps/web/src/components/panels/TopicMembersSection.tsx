import { Effect } from 'effect';
import { Crown, UserMinus } from 'lucide-react';
import { useState } from 'react';
import type { ApiFailure } from '@zilar/client-core';
import type { GroupDetail, TopicMember } from '@/lib/api';
import { EntityAvatar } from '../EntityAvatar';
import { PersonLink } from '../personLink';
import { Menu, MenuItem } from '../ui/menu';
import { StateMessage } from '../ui/state-message';
import { TopicOptionsKey, useRemoveMember } from './TopicActionButtons';
import { LoadFailed, RefreshFailed } from './TopicListNotices';

type GroupMemberRow = GroupDetail['members'][number];

export type MembersState = {
  status: 'loading' | 'ready' | 'error';
  members: TopicMember[];
  message: string;
};

export function TopicMembersSection({
  listsMembers,
  state,
  groupMembers,
  allMembersText,
  me,
  isManager,
  onRetry,
  removeMember,
  onError,
}: {
  listsMembers: boolean;
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
    <section aria-label="People" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5 text-[12px] font-semibold text-muted-foreground">
        <span>People</span>
        {listsMembers && state.status === 'ready' && (
          <span className="font-mono font-normal">{state.members.length}</span>
        )}
      </div>
      {listsMembers ? (
        <>
          {state.status === 'loading' && (
            <StateMessage kind="loading" size="inline" title="Loading…" />
          )}
          {state.status === 'error' && <LoadFailed message={state.message} onRetry={onRetry} />}
          {state.status === 'ready' && state.message !== '' && (
            <RefreshFailed message={state.message} onRetry={onRetry} />
          )}
          {state.status === 'ready' && state.members.length > 0 && (
            <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
              {state.members.map((member) => (
                <MemberItem
                  key={member.userId}
                  member={member}
                  detail={groupMembers.find((item) => item.userId === member.userId)}
                  me={me}
                  isManager={isManager}
                  removeMember={removeMember}
                  onError={onError}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="px-2 text-[13px] text-muted-foreground">{allMembersText}</p>
      )}
    </section>
  );
}

function MemberItem({
  member,
  detail,
  me,
  isManager,
  removeMember,
  onError,
}: {
  member: TopicMember;
  detail: GroupMemberRow | undefined;
  me: string | undefined;
  isManager: boolean;
  removeMember: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { removing, runRemove } = useRemoveMember({ remove: removeMember, onError });
  const canRemove = isManager && member.userId !== me;
  return (
    <div className="flex min-h-[44px] items-center gap-2.5 pl-2.5 pr-2">
      <PersonLink
        target={{ userId: member.userId, handle: detail?.handle }}
        name={member.name}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px]"
      >
        <EntityAvatar
          person={{
            userId: member.userId,
            name: member.name,
            avatarUrl: detail?.avatarUrl,
          }}
          size={28}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate text-[14px]">
            {member.name}
            {member.userId === me && <span className="text-muted-foreground"> (you)</span>}
          </span>
          {detail?.role === 'owner' && (
            <Crown
              className="size-[15px] shrink-0 text-muted-foreground"
              role="img"
              aria-label="Owner"
            />
          )}
          {detail?.role === 'admin' && (
            <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
              admin
            </span>
          )}
        </span>
      </PersonLink>
      {canRemove && (
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`${member.name} options`}
          align="end"
          trigger={<TopicOptionsKey subject={member.name} disabled={removing} />}
        >
          <MenuItem
            icon={UserMinus}
            destructive
            disabled={removing}
            onSelect={() => {
              setMenuOpen(false);
              runRemove(member.userId);
            }}
          >
            Remove from topic
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
