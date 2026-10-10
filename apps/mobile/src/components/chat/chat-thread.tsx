import { useMemo, useState } from 'react';

import { DismissBanner } from '@/components/chat/dismiss-banner';
import { MessageList } from '@/components/chat/message-list';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { useVoicePlayerHost } from '@/components/chat/voice-player';
import { API_URL } from '@/lib/auth';
import { createAttachmentOpener } from '@/lib/attachment-native';
import type { AttachmentOpener } from '@/lib/attachment-ports';
import { safeHttpUrl } from '@/lib/attachments';
import { runInBackground } from '@/lib/effect/run-in-background';
import { getSessionToken } from '@/lib/session-token';
import { useChatStore } from '@/store/chat-store-provider';
import type { ChatSummary, UiMessage } from '@/lib/types';

type ChatThreadProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

/**
 * The message list and the inline error/notice stack. One copy replaces the
 * three identical `MessageList` + `DismissBanner` blocks the screen repeated.
 */
export function ChatThread({ screen, chat }: ChatThreadProps) {
  const react = useChatStore((state) => state.react);
  const startEdit = useChatStore((state) => state.startEdit);
  const deleteForEveryone = useChatStore((state) => state.deleteForEveryone);
  const retrySticker = useChatStore((state) => state.retrySticker);
  const retryAttachment = useChatStore((state) => state.retryAttachment);
  const cancelAttachment = useChatStore((state) => state.cancelAttachment);
  const retryVoice = useChatStore((state) => state.retryVoice);
  const cancelVoice = useChatStore((state) => state.cancelVoice);
  const pinMessage = useChatStore((state) => state.pinMessage);
  const unpinMessage = useChatStore((state) => state.unpinMessage);
  const actionError = useChatStore((state) =>
    state.actionError?.chatId === chat.id ? state.actionError : undefined,
  );
  const dismissActionError = useChatStore((state) => state.dismissActionError);
  const [pinError, setPinError] = useState('');
  const [openingId, setOpeningId] = useState<string | undefined>(undefined);
  const [openError, setOpenError] = useState('');
  // The native attachment seams (T-0150): the opener for the system
  // share/open sheet lives here. The uploader is wired by the store
  // provider: the mock store settles instantly, the real store uploads
  // through the injected expo-file-system seam. The screen owns the opener
  // so taps stay local to the chat.
  const opener: AttachmentOpener = useMemo(
    () => createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken }),
    [],
  );
  // The shared voice playback host (T-0154): one expo-audio player for all
  // bubbles, so only one voice plays at a time. Leaving the chat unmounts
  // the screen and stops playback.
  const voiceHost = useVoicePlayerHost();

  const openAttachment = (message: UiMessage) => {
    const attachment = message.attachment;
    if (attachment === undefined) {
      return;
    }
    // Untrusted or non-http(s) addresses never open: only the server-served
    // upload URL (under the 50 MiB cap, like any attachment) goes to the
    // system sheet.
    if (safeHttpUrl(attachment.url) === undefined) {
      setOpenError('That file cannot be opened here.');
      return;
    }
    setOpeningId(message.id);
    setOpenError('');
    runInBackground(() => opener.open(attachment.url, attachment.name), {
      onSuccess: (result) => {
        if (result.status === 'error') {
          setOpenError(result.message);
        }
      },
      onFailure: () => setOpenError('Could not open that file. Try again.'),
      onSettled: () => setOpeningId((current) => (current === message.id ? undefined : current)),
    });
  };

  const pin = (message: UiMessage) => {
    setPinError('');
    runInBackground(() => pinMessage(chat.id, message.id), {
      onFailure: () => setPinError('Could not pin the message. Try again.'),
    });
  };

  const unpin = (message: UiMessage) => {
    const pinRow = screen.pinFor(chat.id, message.id);
    if (pinRow === undefined) {
      return;
    }
    setPinError('');
    const pinId = pinRow.id;
    runInBackground(() => unpinMessage(chat.id, pinId), {
      onFailure: () => setPinError('Could not unpin the message. Try again.'),
    });
  };

  return (
    <>
      <MessageList
        chat={chat}
        onReply={screen.startReply}
        onReact={(message, emoji) => react(chat.id, message.id, emoji)}
        onEdit={(message) => startEdit(chat.id, message.id)}
        onDelete={(message) => deleteForEveryone(chat.id, message.id)}
        onForward={(message) => screen.setForwarding([message])}
        selection={screen.selection}
        onPin={pin}
        onUnpin={unpin}
        pinnedIds={screen.pinnedIds}
        jumpToMessageId={screen.jumpToMessageId}
        onJumped={() => screen.setJumpToMessageId(undefined)}
        onRetrySticker={(message) => retrySticker(chat.id, message.id)}
        onRetryAttachment={(message) => retryAttachment(chat.id, message.id)}
        onCancelAttachment={(message) => cancelAttachment(chat.id, message.id)}
        onRetryVoice={(message) => retryVoice(chat.id, message.id)}
        onCancelVoice={(message) => cancelVoice(chat.id, message.id)}
        onOpenAttachment={openAttachment}
        openingAttachmentId={openingId}
        voiceHost={voiceHost}
      />
      {pinError !== '' ? (
        <DismissBanner tone="error" message={pinError} onDismiss={() => setPinError('')} />
      ) : null}
      {actionError !== undefined ? (
        <DismissBanner
          tone="error"
          message={actionError.message}
          onDismiss={() => dismissActionError()}
        />
      ) : null}
      {openError !== '' ? (
        <DismissBanner tone="error" message={openError} onDismiss={() => setOpenError('')} />
      ) : null}
      {screen.jumpMissed ? (
        <DismissBanner
          tone="notice"
          message="Message not found"
          onDismiss={() => screen.setJumpMissed(false)}
        />
      ) : null}
    </>
  );
}
