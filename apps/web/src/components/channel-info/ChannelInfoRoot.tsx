import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  Bell,
  BellOff,
  Bot,
  Link,
  LogOut,
  Megaphone,
  MoreHorizontal,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from '../ais/AiPageShell';
import { ConfirmDialog } from '../ConfirmDialog';
import { EntityAvatar } from '../EntityAvatar';
import { ContentNav } from '../group-info/ContentNav';
import { DeleteGroupDialog } from '../group-info/GroupExit';
import { PanelFailure } from '../panels/groupPanelOps';
import { IconButton } from '../ui/icon-button';
import { ListRow } from '../ui/list-row';
import { Menu, MenuItem } from '../ui/menu';
import { PanelKey } from '../ui/panel-key';
import { useToast } from '../ui/toast';

/** The pages of the channel info panel; `root` is the page itself (T-1519). */
export type ChannelInfoPageId =
  'root' | 'admins' | 'subscribers' | 'ais' | 'links' | 'activity' | 'allowed' | 'settings';

/** The title of each subpage, shown by `GroupInfoPage noun="channel"`. */
export const CHANNEL_INFO_TITLES: Record<ChannelInfoPageId, string> = {
  root: '',
  admins: 'Admins',
  subscribers: 'Subscribers',
  ais: 'AIs',
  links: 'Invite links',
  activity: 'Activity',
  allowed: 'Always allowed',
  settings: 'Settings',
};

const MUTE_ERROR = 'Could not update notifications. Try again.';

/** The count at the right of a row, in mono as the design asks. */
function count(value: number): ReactNode {
  return <span className="font-mono text-[12px]">{value}</span>;
}

/**
 * The channel info root page (T-1519): the picture, the name and the subscriber
 * count, the Mute / Search / Share / More keys, and the grouped lists whose rows
 * open the subpages. Built like `GroupInfoRoot` after `WebChannel.dc.html`.
 */
export function ChannelInfoRoot({
  chat,
  title,
  groupId,
  count: subscriberCount,
  handle,
  description,
  adminsCount,
  aisCount,
  linksCount,
  isManager,
  isOwner,
  canLeave,
  leaving,
  leaveError,
  onLeave,
  onClose,
  onSearch,
  onOpenMedia,
  onOpenPage,
}: {
  chat: ChatSummary;
  title: string;
  /** The channel's id, for the More key's Delete channel dialog. */
  groupId: string | undefined;
  /** The subscriber count, shown in the header and on the Subscribers row. */
  count: number;
  /** The public handle, when the channel has one. */
  handle: string | null;
  /** The channel's description, when it has one. */
  description: string | null;
  /** The admins count, when it is known (subscribers load it). */
  adminsCount: number | undefined;
  aisCount: number;
  linksCount: number | undefined;
  isManager: boolean;
  isOwner: boolean;
  /** A subscriber: show the red Leave channel row. */
  canLeave: boolean;
  leaving: boolean;
  leaveError: string;
  onLeave: () => void;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
  onOpenPage: (page: ChannelInfoPageId) => void;
}) {
  const storeApi = useChatStoreApi();
  const toast = useToast();
  const pinCount = useChatSelector((s) => s.pinsByChat[chat.id]?.length ?? 0);
  const muted = chat.muted === true;
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

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

  const shareUrl =
    handle === null
      ? null
      : `${typeof window === 'undefined' ? '' : window.location.origin}/@${encodeURIComponent(handle)}`;
  const [, runShare] = useAction((url: string) =>
    Effect.tryPromise(() => copyText(url)).pipe(
      Effect.tap(() => Effect.sync(() => toast('Link copied'))),
    ),
  );

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-end px-3">
        <IconButton aria-label="Close channel info" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-1.5 px-4 pb-4 text-center">
          <EntityAvatar chat={{ id: chat.id, title, avatarUrl: chat.avatarUrl }} size={84} />
          <h2 className="mt-1.5 flex max-w-full items-center gap-1.5 text-[20px] font-semibold tracking-tight">
            <span className="min-w-0 truncate">{title}</span>
            <Megaphone
              role="img"
              aria-label="Channel"
              className="size-4 shrink-0 text-subtle-foreground"
            />
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {handle !== null && (
              <>
                <span className="font-mono">@{handle}</span>
                {' · '}
              </>
            )}
            {subscriberCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'}
          </p>
          {description !== null && description !== '' && (
            <p className="mt-1 line-clamp-3 max-w-full text-[13px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="flex justify-center gap-1 pb-[18px]">
          <PanelKey
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? BellOff : Bell}
            onClick={toggleMute}
            disabled={muteBusy}
          />
          <PanelKey label="Search" icon={Search} onClick={onSearch} />
          {shareUrl !== null && (
            // The visible label is "Share"; the accessible name spells it out.
            <div className="flex w-16 flex-col items-center gap-1.5">
              <IconButton aria-label="Share link" onClick={() => runShare(shareUrl)}>
                <Share2 className="size-[18px]" aria-hidden="true" />
              </IconButton>
              <span className="text-[12px] text-muted-foreground">Share</span>
            </div>
          )}
          {isOwner && (
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
                <MenuItem
                  icon={Trash2}
                  destructive
                  onSelect={() => {
                    setMoreOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete channel
                </MenuItem>
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
              icon={<ShieldCheck className="size-4" aria-hidden="true" />}
              title="Admins"
              trailing={adminsCount === undefined ? undefined : count(adminsCount)}
              chevron
              onClick={() => onOpenPage('admins')}
            />
            {isManager && (
              <ListRow
                icon={<Users className="size-4" aria-hidden="true" />}
                title="Subscribers"
                trailing={count(subscriberCount)}
                chevron
                onClick={() => onOpenPage('subscribers')}
              />
            )}
            <ListRow
              icon={<Bot className="size-4" aria-hidden="true" />}
              title="AIs"
              trailing={count(aisCount)}
              chevron
              onClick={() => onOpenPage('ais')}
            />
            {isManager && (
              <ListRow
                icon={<Link className="size-4" aria-hidden="true" />}
                title="Invite links"
                trailing={linksCount === undefined ? undefined : count(linksCount)}
                chevron
                onClick={() => onOpenPage('links')}
              />
            )}
          </nav>

          <ContentNav
            chatId={chat.id}
            pinCount={pinCount}
            isManager={isManager}
            onOpenMedia={onOpenMedia}
            onOpenPage={onOpenPage}
          />

          {isOwner && (
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

          {/* The red bottom row: subscribers leave here; the owner deletes from More. */}
          {canLeave && (
            <div className="flex flex-col gap-1">
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <ListRow
                  icon={<LogOut className="size-4" aria-hidden="true" />}
                  title="Leave channel"
                  danger
                  onClick={() => {
                    if (!leaving) {
                      setLeaveOpen(true);
                    }
                  }}
                />
              </div>
              {leaveError !== '' && <FieldError>{leaveError}</FieldError>}
              {leaveOpen && (
                <ConfirmDialog
                  title={`Leave ${title}?`}
                  body="You will stop receiving messages from this channel. You can join again later."
                  confirmLabel="Leave"
                  onCancel={() => setLeaveOpen(false)}
                  onConfirm={() => {
                    setLeaveOpen(false);
                    onLeave();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <DeleteGroupDialog
        groupId={groupId}
        title={title}
        noun="channel"
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    </>
  );
}
