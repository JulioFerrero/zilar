import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  Bell,
  BellOff,
  Image as ImageIcon,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { PanelFailure } from '../panels/groupPanelOps';
import { EntityAvatar } from '../EntityAvatar';
import { IconButton } from '../ui/icon-button';
import { ListRow } from '../ui/list-row';
import { Menu, MenuItem } from '../ui/menu';
import { PanelKey } from '../ui/panel-key';
import { ContentNav } from './ContentNav';
import { DeleteGroupDialog, LeaveGroupRow } from './GroupExit';
import { AvatarStack } from './AvatarStack';
import type { AvatarStackEntry } from './AvatarStack';
import { TopicsSection } from './TopicsSection';

/** The pages of the group info panel; `root` is the page itself (T-1494). */
export type GroupInfoPageId =
  'root' | 'people' | 'links' | 'tools' | 'activity' | 'allowed' | 'settings';

/** The title of each subpage, shown by `GroupInfoPage`. */
export const GROUP_INFO_TITLES: Record<GroupInfoPageId, string> = {
  root: '',
  people: 'People and AIs',
  links: 'Invite links',
  tools: 'Tools and routines',
  activity: 'Activity',
  allowed: 'Always allowed',
  settings: 'Settings',
};

const MUTE_ERROR = 'Could not update notifications. Try again.';

/**
 * The group info root page (T-1494): the picture, the name and the member
 * count, the Mute / Search / Add keys, and the grouped lists whose rows open
 * the subpages. One row opens People and AIs (T-1857).
 */
export function GroupInfoRoot({
  chat,
  title,
  groupId,
  memberCount,
  stack,
  isManager,
  isOwner,
  canLeave,
  onClose,
  onSearch,
  onOpenMedia,
  onOpenBackground,
  onOpenPage,
  onAddMembers,
}: {
  chat: ChatSummary;
  title: string;
  /** The group's id, for the More key's Delete group dialog. */
  groupId: string | undefined;
  /** The members plus AIs count, shown in the row's trailing side. */
  memberCount: number;
  /** The group's AIs first, then its people, for the row's avatar stack. */
  stack: AvatarStackEntry[];
  isManager: boolean;
  isOwner: boolean;
  /** A member who is not the owner: show the red Leave group row. */
  canLeave: boolean;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
  onOpenBackground: () => void;
  onOpenPage: (page: GroupInfoPageId) => void;
  onAddMembers: () => void;
}) {
  const storeApi = useChatStoreApi();
  const pinCount = useChatSelector((s) => s.pinsByChat[chat.id]?.length ?? 0);
  const muted = chat.muted === true;
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [muteState, runMute] = useAction((next: boolean) =>
    Effect.tryPromise({
      try: () => storeApi.getState().setMuted(chat.id, next ? 'forever' : null),
      catch: () => new PanelFailure({ message: MUTE_ERROR }),
    }),
  );
  const muteBusy = isWaiting(muteState);
  const muteError = muteBusy ? undefined : failureOf(muteState)?.message;

  const toggleMute = (): void => {
    if (!muteBusy) {
      runMute(!muted);
    }
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-end px-3">
        <IconButton aria-label="Close group info" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-1.5 px-4 pb-4">
          <EntityAvatar chat={{ id: chat.id, title, avatarUrl: chat.avatarUrl }} size={84} />
          <h2 className="mt-1.5 max-w-full truncate text-[20px] font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>

        <div className="flex justify-center gap-1 pb-[18px]">
          <PanelKey
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? BellOff : Bell}
            onClick={toggleMute}
            disabled={muteBusy}
          />
          <PanelKey label="Search" icon={Search} onClick={onSearch} />
          {isManager && <PanelKey label="Add" icon={UserPlus} onClick={onAddMembers} />}
          {(isManager || isOwner) && (
            // Menu needs its own trigger element, so the fourth key carries the
            // PanelKey layout itself instead of wrapping `PanelKey`.
            <div className="flex w-16 flex-col items-center gap-1.5">
              <Menu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                label="More"
                trigger={
                  <IconButton aria-label="More">
                    <MoreHorizontal className="size-[18px]" aria-hidden="true" />
                  </IconButton>
                }
              >
                {isManager && (
                  <MenuItem
                    icon={ImageIcon}
                    onSelect={() => {
                      setMoreOpen(false);
                      onOpenBackground();
                    }}
                  >
                    Group background
                  </MenuItem>
                )}
                {isOwner && (
                  <MenuItem
                    icon={Trash2}
                    destructive
                    onSelect={() => {
                      setMoreOpen(false);
                      setDeleteOpen(true);
                    }}
                  >
                    Delete group
                  </MenuItem>
                )}
              </Menu>
              <span className="text-[12px] text-muted-foreground">More</span>
            </div>
          )}
        </div>

        {muteError !== undefined && (
          <p role="alert" className="px-3 pb-3 text-center text-[13px] text-danger">
            {muteError}
          </p>
        )}

        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <nav
            aria-label="People"
            className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
          >
            <ListRow
              leading={<AvatarStack entries={stack.slice(0, 5)} size={18} />}
              title="People and AIs"
              trailing={<span className="font-mono text-[12px]">{memberCount}</span>}
              chevron
              onClick={() => onOpenPage('people')}
            />
          </nav>

          {/* T-1786: Your/Other topics, split by the caller's membership. */}
          <TopicsSection chat={chat} onClose={onClose} />

          <ContentNav
            chatId={chat.id}
            pinCount={pinCount}
            isManager={isManager}
            onOpenMedia={onOpenMedia}
            onOpenPage={onOpenPage}
            extraRow={
              <ListRow
                icon={<Wrench className="size-4" aria-hidden="true" />}
                title="Tools and routines"
                chevron
                onClick={() => onOpenPage('tools')}
              />
            }
          />

          {isManager && (
            <nav
              aria-label="Settings"
              className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
            >
              <ListRow
                icon={<Settings className="size-4" aria-hidden="true" />}
                title="Settings"
                chevron
                onClick={() => onOpenPage('settings')}
              />
            </nav>
          )}

          {/* The red bottom row: non-owners leave here; the owner deletes from More. */}
          {canLeave && <LeaveGroupRow chatId={chat.id} title={title} onClose={onClose} />}
        </div>
      </div>

      <DeleteGroupDialog
        groupId={groupId}
        title={title}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    </>
  );
}
