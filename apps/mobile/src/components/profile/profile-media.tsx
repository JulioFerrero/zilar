import { useRouter } from 'expo-router';
import { Effect } from 'effect';
import { Image } from 'lucide-react-native';
import { useState } from 'react';

import { MediaSheet } from '@/components/chat/media-sheet';
import { openSearchHitEffect } from '@/components/chat/search-jump';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { useChatStore } from '@/store/chat-store-provider';

type ProfileMediaProps = {
  chatId: string;
};

/**
 * The DM's Shared media row for the profile screen (T-1664): the same Content
 * row and sheet the group info page shows. The sheet loads the DM's media and
 * a tap jumps the chat at that message, through the search-hit driver.
 */
export function ProfileMedia({ chatId }: ProfileMediaProps) {
  const router = useRouter();
  const openAtMessage = useChatStore((state) => state.openAtMessage);
  const [open, setOpen] = useState(false);

  const jump = (messageId: string) => {
    setOpen(false);
    Effect.runFork(
      openSearchHitEffect(
        {
          openAtMessage,
          pushChat: (id) => router.push({ pathname: '/chat/[id]', params: { id } }),
          pushChatNotFound: (id) =>
            router.push({ pathname: '/chat/[id]', params: { id, notFound: '1' } }),
          onNotFound: () => {},
        },
        chatId,
        messageId,
      ).pipe(
        Effect.catch(() => Effect.void),
        Effect.catchDefect(() => Effect.void),
      ),
    );
  };

  return (
    <>
      <InfoRowGroup>
        <InfoRow icon={Image} label="Shared media" onPress={() => setOpen(true)} />
      </InfoRowGroup>
      {open ? <MediaSheet chatId={chatId} onJump={jump} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
