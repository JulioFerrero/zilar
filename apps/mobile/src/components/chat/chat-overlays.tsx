import { useState } from 'react';

import { ForwardSheet } from '@/components/chat/forward-sheet';
import { MediaSheet } from '@/components/chat/media-sheet';
import { PinsSheet } from '@/components/chat/pins-sheet';
import type { SheetPin } from '@/components/chat/pins-sheet';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { runInBackground } from '@/lib/effect/run-in-background';
import { useChatStore } from '@/store/chat-store-provider';
import type { ChatSummary } from '@/lib/types';

type ChatOverlaysProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

/** The pins sheet, forward sheet and media sheet, shared by every branch. */
export function ChatOverlays({ screen, chat }: ChatOverlaysProps) {
  const canPinChat = useChatStore((state) => state.canPin(chat.id));
  const unpinMessage = useChatStore((state) => state.unpinMessage);
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const [pinsSheetError, setPinsSheetError] = useState('');

  const sheetUnpin = (pin: SheetPin) => {
    setUnpinningId(pin.id);
    setPinsSheetError('');
    runInBackground(() => unpinMessage(chat.id, pin.id), {
      onFailure: () => setPinsSheetError('Could not unpin. Try again.'),
      onSettled: () => setUnpinningId(null),
    });
  };

  return (
    <>
      <PinsSheet
        open={screen.pinsOpen}
        pins={screen.pins}
        canUnpin={canPinChat}
        unpinningId={unpinningId}
        error={pinsSheetError}
        onUnpin={sheetUnpin}
        onJump={screen.jumpToPin}
        onClose={() => screen.setPinsOpen(false)}
      />
      {screen.forwarding !== null ? (
        <ForwardSheet messages={screen.forwarding} onClose={() => screen.setForwarding(null)} />
      ) : null}
      {screen.mediaOpen ? (
        <MediaSheet
          chatId={chat.id}
          title="Media, files and links"
          onJump={screen.jumpTo}
          onClose={() => screen.setMediaOpen(false)}
        />
      ) : null}
    </>
  );
}
