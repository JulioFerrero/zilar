import type { ChatSummary } from '@zilar/chat-core';
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
import { useChatSelector } from '@/store/ChatStoreProvider';
import { useMuteToggle } from '../useMuteToggle';
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

export type GroupInfoPageId =
  'root' | 'people' | 'links' | 'tools' | 'activity' | 'allowed' | 'settings';

export const GROUP_INFO_TITLES: Record<GroupInfoPageId, string> = {
  root: '',
  people: 'People and AIs',
  links: 'Invite links',
  tools: 'Tools and routines',
  activity: 'Activity',
  allowed: 'Always allowed',
  settings: 'Settings',
};

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
  groupId: string | undefined;
  memberCount: number;
  stack: AvatarStackEntry[];
  isManager: boolean;
  isOwner: boolean;
  canLeave: boolean;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
  onOpenBackground: () => void;
  onOpenPage: (page: GroupInfoPageId) => void;
  onAddMembers: () => void;
}) {
  const { muted, busy: muteBusy, error: muteError, toggle: toggleMute } = useMuteToggle(chat);
  const pinCount = useChatSelector((s) => s.pinsByChat[chat.id]?.length ?? 0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
