import { useRouter } from 'expo-router';
import { Effect } from 'effect';
import { type ComponentProps, useEffect, useState } from 'react';

import { MediaSheet } from '@/components/chat/media-sheet';
import { PinsSheet, type SheetPin } from '@/components/chat/pins-sheet';
import { openSearchHitEffect } from '@/components/chat/search-jump';
import { ActivityPage } from '@/components/group-info/activity-page';
import { AllowedPage, type GroupRulesHandle } from '@/components/group-info/allowed-page';
import { MembersPage } from '@/components/group-info/members-page';
import { GroupInfoRoot } from '@/components/group-info/root-page';
import { SettingsPage } from '@/components/group-info/settings-page';
import { ToolsPage } from '@/components/group-info/tools-page';
import { runInBackground } from '@/lib/effect/run-in-background';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The Group info pages and the Content group's sheets (T-1573). The route owns
 * the data and the `page` state; this module holds the page switch and the
 * media/pins state, so `[id].tsx` stays a composition and under 400 lines.
 */

export type GroupInfoPage = 'root' | 'members' | 'tools' | 'activity' | 'allowed' | 'settings';

type RootProps = ComponentProps<typeof GroupInfoRoot>;
type MembersProps = ComponentProps<typeof MembersPage>;
type SettingsProps = ComponentProps<typeof SettingsPage>;

/**
 * The Content rows' state: media and pins are chat-scoped (the group's own
 * chat row), so the sheets load for `chatId` exactly like the chat screen's.
 * `pinsCount` is `undefined` until the pins have loaded, so the root row shows
 * no number before then (the board's count rule).
 */
export interface GroupContent {
  chatId: string | undefined;
  pinsCount: number | undefined;
  openMedia: () => void;
  openPins: () => void;
  mediaOpen: boolean;
  pinsOpen: boolean;
  pins: SheetPin[];
  canUnpin: boolean;
  unpinningId: string | null;
  pinsError: string;
  closeMedia: () => void;
  closePins: () => void;
  unpin: (pin: SheetPin) => void;
  jump: (messageId: string) => void;
}

export function useGroupContent(groupChatId: string | undefined): GroupContent {
  const router = useRouter();
  const openAtMessage = useChatStore((state) => state.openAtMessage);
  const pins = useChatStore((state) => state.pins(groupChatId ?? ''));
  // The loader the chat screen uses: `refreshPins` runs the store's `loadPins`.
  const refreshPins = useChatStore((state) => state.refreshPins);
  const unpinMessage = useChatStore((state) => state.unpinMessage);
  const canUnpin = useChatStore((state) => state.canPin(groupChatId ?? ''));
  const [mediaOpen, setMediaOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const [pinsError, setPinsError] = useState('');

  // The root's Pinned count needs the pins loaded. A failure stays silent
  // here; `openPins` loads again and reports it in the sheet.
  useEffect(() => {
    if (groupChatId === undefined) {
      return;
    }
    let alive = true;
    runInBackground(() => refreshPins(groupChatId), {
      onSuccess: () => {
        if (alive) {
          setPinsLoaded(true);
        }
      },
    });
    return () => {
      alive = false;
    };
  }, [groupChatId, refreshPins]);

  // A media or pin jump opens the group's chat at the message, through the
  // search-hit driver: `openAtMessage` pages back, then the chat opens on it.
  const jump = (messageId: string) => {
    if (groupChatId === undefined) {
      return;
    }
    Effect.runFork(
      openSearchHitEffect(
        {
          openAtMessage,
          pushChat: (chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } }),
          pushChatNotFound: (chatId) =>
            router.push({ pathname: '/chat/[id]', params: { id: chatId, notFound: '1' } }),
          onNotFound: () => {},
        },
        groupChatId,
        messageId,
      ).pipe(
        Effect.catch(() => Effect.void),
        Effect.catchDefect(() => Effect.void),
      ),
    );
  };

  const openMedia = () => {
    if (groupChatId !== undefined) {
      setMediaOpen(true);
    }
  };

  const openPins = () => {
    if (groupChatId === undefined) {
      return;
    }
    setPinsError('');
    setPinsOpen(true);
    runInBackground(() => refreshPins(groupChatId), {
      onSuccess: () => setPinsLoaded(true),
      onFailure: () => setPinsError('Could not load pinned messages. Try again.'),
    });
  };

  const unpin = (pin: SheetPin) => {
    if (groupChatId === undefined) {
      return;
    }
    setUnpinningId(pin.id);
    setPinsError('');
    runInBackground(() => unpinMessage(groupChatId, pin.id), {
      onFailure: () => setPinsError('Could not unpin. Try again.'),
      onSettled: () => setUnpinningId(null),
    });
  };

  return {
    chatId: groupChatId,
    pinsCount: pinsLoaded ? pins.length : undefined,
    openMedia,
    openPins,
    mediaOpen,
    pinsOpen,
    pins,
    canUnpin,
    unpinningId,
    pinsError,
    closeMedia: () => setMediaOpen(false),
    closePins: () => setPinsOpen(false),
    unpin,
    jump,
  };
}

/** The media and pins sheets, mounted beside the pages while `[id].tsx` runs. */
export function GroupContentSheets({ content }: { content: GroupContent }) {
  return (
    <>
      {content.mediaOpen ? (
        <MediaSheet
          chatId={content.chatId ?? ''}
          onJump={content.jump}
          onClose={content.closeMedia}
        />
      ) : null}

      <PinsSheet
        open={content.pinsOpen}
        pins={content.pins}
        canUnpin={content.canUnpin}
        unpinningId={content.unpinningId}
        error={content.pinsError}
        onUnpin={content.unpin}
        onJump={(pin) => content.jump(pin.messageId)}
        onClose={content.closePins}
      />
    </>
  );
}

/**
 * The page switch (T-1569, T-1573, T-1574): one page per `page`, all full
 * screen with the root's back key. `root`, `members` and `settings` arrive
 * whole so the route only builds their props once.
 */
export function GroupInfoPages({
  page,
  onBack,
  groupId,
  rules,
  root,
  members,
  settings,
}: {
  page: GroupInfoPage;
  onBack: () => void;
  groupId: string;
  rules: GroupRulesHandle;
  root: RootProps;
  members: MembersProps;
  settings: SettingsProps;
}) {
  if (page === 'members') {
    return <MembersPage {...members} />;
  }
  if (page === 'settings') {
    return <SettingsPage {...settings} />;
  }
  if (page === 'tools') {
    return <ToolsPage groupId={groupId} onBack={onBack} />;
  }
  if (page === 'activity') {
    return <ActivityPage groupId={groupId} onBack={onBack} />;
  }
  if (page === 'allowed') {
    return <AllowedPage handle={rules} onBack={onBack} />;
  }
  return <GroupInfoRoot {...root} />;
}
