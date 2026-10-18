import { chatSubtitle, localpartOf, type ChatSummary } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  Ban,
  Bell,
  BellOff,
  Copy,
  Image as ImageIcon,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { HandleProfile } from '@/lib/api';
import { blockUser, lookupByHandle, unblockUser } from '@/lib/api';
import { refreshBlockedJids, useBlockedJids } from '@/lib/blockedJids';
import { copyText } from '@/lib/clipboard';
import { dmContactFor, dmHandleCandidate } from '@/lib/contacts';
import { fromApi } from '@/lib/effect/api-effect';
import { runWeb } from '@/lib/effect/runtime';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { focusComposer } from '@/components/composer/useComposerFocus';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { EntityAvatar } from './EntityAvatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';
import { ListRow } from './ui/list-row';
import { PanelKey } from './ui/panel-key';
import { Sheet } from './ui/sheet';
import { useToast } from './ui/toast';

const COPY_TOAST = 'Username copied';
const MUTE_ERROR = 'Could not update notifications. Try again.';
const BLOCK_ERROR = 'Could not block. Try again.';
const UNBLOCK_ERROR = 'Could not unblock. Try again.';

/** A failed panel action; `message` is the fixed sentence the panel shows. */
class ContactFailure extends Data.TaggedError('ContactFailure')<{ readonly message: string }> {}

/** One grouped info row: a small muted label over the value. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-muted-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-[15px]">{children}</span>
      </span>
    </div>
  );
}

/**
 * The contact info panel for a DM (T-1323): the Telegram `User info` drawer,
 * opened from the chat header. It shows the peer's big photo, name and status
 * (the header's subtitle source, `chatSubtitle`), a round action row (Message,
 * Mute, Search), the `@handle` with copy and the bio when the profile carries
 * one, Shared media, and Block / Unblock in the destructive colour.
 *
 * The handle comes from the contacts list (T-0163); the by-handle profile
 * (`GET /api/users/by-handle/:handle`, T-1258) adds the bio and the relation.
 */
export function ContactPanel({
  chat,
  onClose,
  onSearch,
  onOpenMedia,
}: {
  chat: ChatSummary;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
}) {
  const storeApi = useChatStoreApi();
  const toast = useToast();
  const contacts = useChatSelector((s) => s.contacts);
  const blockedJids = useBlockedJids();
  const contact = dmContactFor(chat, contacts);

  const knownHandle = contact?.handle;
  const candidate = dmHandleCandidate(chat, contacts);
  const [profileResult] = useQuery(
    () =>
      candidate === undefined
        ? Effect.succeed<HandleProfile | undefined>(undefined)
        : fromApi(() => lookupByHandle(candidate)).pipe(
            Effect.orElseSucceed((): HandleProfile | undefined => undefined),
          ),
    [candidate],
  );
  const profile = AsyncResult.getOrElse(profileResult, (): HandleProfile | undefined => undefined);
  const handle =
    knownHandle !== undefined && knownHandle !== null && knownHandle !== ''
      ? knownHandle
      : profile?.handle;
  const bio = profile?.bio;
  const userId = contact?.userId ?? profile?.userId;

  const [blockedOverride, setBlockedOverride] = useState<boolean | undefined>(undefined);
  const blocked =
    blockedOverride ?? (profile?.relation === 'blocked' || blockedJids.has(localpartOf(chat.id)));

  const muted = chat.muted === true;
  const [muteState, runMute] = useAction((next: boolean) =>
    Effect.tryPromise({
      try: () => storeApi.getState().setMuted(chat.id, next ? 'forever' : null),
      catch: () => new ContactFailure({ message: MUTE_ERROR }),
    }),
  );
  const [blockState, runBlock] = useAction(
    (input: { action: 'block' | 'unblock'; userId: string }) =>
      fromApi(() =>
        input.action === 'block' ? blockUser(input.userId) : unblockUser(input.userId),
      ).pipe(
        Effect.mapError(
          () =>
            new ContactFailure({
              message: input.action === 'block' ? BLOCK_ERROR : UNBLOCK_ERROR,
            }),
        ),
        Effect.tap(() => Effect.sync(() => setBlockedOverride(input.action === 'block'))),
        Effect.andThen(fromApi(() => refreshBlockedJids()).pipe(Effect.ignore)),
        Effect.asVoid,
      ),
  );
  const muteBusy = isWaiting(muteState);
  const blockBusy = isWaiting(blockState);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const error =
    (muteBusy ? undefined : failureOf(muteState)?.message) ??
    (blockBusy ? undefined : failureOf(blockState)?.message);

  const status = chatSubtitle(chat, new Date());
  const online = chat.online === true;

  // Message closes the panel and focuses the composer on the next macrotask,
  // once the sheet has unmounted (a dialog would otherwise swallow the focus).
  const startMessage = (): void => {
    onClose();
    void runWeb(
      Effect.sleep(0).pipe(
        Effect.andThen(
          Effect.sync(() => {
            focusComposer();
          }),
        ),
      ),
    );
  };

  const toggleMute = (): void => {
    if (muteBusy) {
      return;
    }
    runMute(!muted);
  };

  const copyHandle = (): void => {
    if (handle === undefined) {
      return;
    }
    void copyText(`@${handle}`).then(
      () => {
        toast(COPY_TOAST);
      },
      () => undefined,
    );
  };

  const confirmBlock = (): void => {
    setConfirmingBlock(false);
    if (userId !== undefined) {
      runBlock({ action: 'block', userId });
    }
  };

  const unblock = (): void => {
    if (userId !== undefined) {
      runBlock({ action: 'unblock', userId });
    }
  };

  return (
    <Sheet open onClose={onClose} ariaLabel={`${chat.title} info`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-divider p-2 pl-4">
        <span className="truncate text-[15px] font-semibold">Contact info</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close contact panel"
          onClick={onClose}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 *:shrink-0">
        <div className="flex flex-col items-center gap-1 pt-2">
          <EntityAvatar
            chat={{ id: chat.id, title: chat.title, avatarUrl: profile?.image ?? chat.avatarUrl }}
            size={96}
            online={online}
          />
          <div className="mt-2 truncate text-[20px] font-semibold">{chat.title}</div>
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {online && <span aria-hidden="true" className="size-2 rounded-full bg-online" />}
            <span className="truncate">{status}</span>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          <PanelKey label="Message" icon={MessageCircle} onClick={startMessage} />
          <PanelKey
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? BellOff : Bell}
            onClick={toggleMute}
            disabled={muteBusy}
          />
          <PanelKey label="Search" icon={Search} onClick={onSearch} />
        </div>

        {(handle !== undefined || (bio !== undefined && bio !== '')) && (
          <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
            {handle !== undefined && (
              <InfoRow label="Username">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">@{handle}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Copy username"
                    onClick={copyHandle}
                    className="shrink-0 rounded-lg text-muted-foreground"
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </InfoRow>
            )}
            {bio !== undefined && bio !== '' && <InfoRow label="Bio">{bio}</InfoRow>}
          </div>
        )}

        <section aria-label="Shared media">
          <ListRow
            icon={<ImageIcon className="size-4" aria-hidden="true" />}
            title="Shared media"
            chevron
            onClick={onOpenMedia}
          />
        </section>

        {userId !== undefined && (
          <div className="mt-auto">
            {blocked ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={blockBusy}
                onClick={unblock}
                className="w-full"
              >
                {blockBusy ? 'Unblocking…' : 'Unblock'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="lg"
                disabled={blockBusy}
                onClick={() => setConfirmingBlock(true)}
                className="w-full"
              >
                <Ban className="size-4" aria-hidden="true" />
                Block
              </Button>
            )}
          </div>
        )}

        {error !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>

      {confirmingBlock && (
        <ConfirmDialog
          title={`Block ${chat.title}?`}
          body="They are not told. You won't see their contact requests."
          confirmLabel="Block"
          onConfirm={confirmBlock}
          onCancel={() => setConfirmingBlock(false)}
        />
      )}
    </Sheet>
  );
}
