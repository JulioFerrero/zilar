import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { ChatJumpProvider } from '@/components/chat/chat-jump-context';
import { ChatNoticeProvider } from '@/components/chat/chat-notice-context';
import { MessageList } from '@/components/chat/message-list';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { useVoicePlayerHost } from '@/components/chat/voice-player-host';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { API_URL } from '@/lib/auth';
import { mediaUrl } from '@/lib/attachment-common';
import { createAttachmentOpener } from '@/lib/attachment-opener';
import type { AttachmentOpener } from '@/lib/attachment-ports';
import { safeHttpUrl } from '@/lib/attachments';
import { runInBackground } from '@/lib/effect/run-in-background';
import { getSessionToken } from '@/lib/session-token';
import { useChatStore, useChatStoreApi } from '@/store/chat-store-provider';
import type { ChatSummary, UiMessage } from '@/lib/types';

type ChatThreadProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

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
  const storeApi = useChatStoreApi();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastSeq = useRef(0);
  const [openingId, setOpeningId] = useState<string | undefined>(undefined);
  const showToast = (text: string, tone: 'error' | 'notice' = 'error') => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  };
  const dismissToast = useCallback(() => setToast(null), []);
  const opener: AttachmentOpener = useMemo(
    () => createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken }),
    [],
  );
  // One shared player for all bubbles, so only one voice plays at a time.
  const voiceHost = useVoicePlayerHost(chat.id);

  const openAttachment = (message: UiMessage) => {
    const attachment = message.attachment;
    if (attachment === undefined) {
      return;
    }
    // Untrusted or non-http(s) addresses never open: only the server-served URL
    // (under the 50 MiB cap) goes to the system sheet, through `GET /api/files` so
    // the download carries the bearer; the origin guard keeps it off other hosts.
    if (safeHttpUrl(attachment.url) === undefined) {
      showToast('That file cannot be opened here.');
      return;
    }
    setOpeningId(message.id);
    runInBackground(() => opener.open(mediaUrl(chat.id, attachment.url), attachment.name), {
      onSuccess: (result) => {
        if (result.status === 'error') {
          showToast(result.message);
        }
      },
      onFailure: () => showToast('Could not open that file. Try again.'),
      onSettled: () => setOpeningId((current) => (current === message.id ? undefined : current)),
    });
  };

  const pin = (message: UiMessage) => {
    runInBackground(() => pinMessage(chat.id, message.id), {
      onFailure: () => showToast('Could not pin the message. Try again.'),
    });
  };

  const unpin = (message: UiMessage) => {
    const pinRow = screen.pinFor(chat.id, message.id);
    if (pinRow === undefined) {
      return;
    }
    const pinId = pinRow.id;
    runInBackground(() => unpinMessage(chat.id, pinId), {
      onFailure: () => showToast('Could not unpin the message. Try again.'),
    });
  };

  const forward = (message: UiMessage) => {
    const album = message.album;
    if (album === undefined) {
      screen.setForwarding([message]);
      return;
    }
    screen.setForwarding(
      storeApi
        .getState()
        .messages(chat.id)
        .filter((item) => item.album?.id === album.id && item.senderId === message.senderId)
        .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0)),
    );
  };

  useEffect(() => {
    if (actionError !== undefined) {
      showToast(actionError.message);
      dismissActionError();
    }
  }, [actionError, dismissActionError]);

  useEffect(() => {
    if (screen.jumpMissed) {
      showToast('Message not found', 'notice');
      screen.setJumpMissed(false);
    }
  }, [screen]);

  const partialNotice = screen.partialNotice;
  const clearPartialNotice = screen.setPartialNotice;
  useEffect(() => {
    if (partialNotice) {
      showToast('AI created. Some settings could not be saved.', 'notice');
      clearPartialNotice(false);
    }
  }, [partialNotice, clearPartialNotice]);

  const notice = screen.notice;
  const clearNotice = screen.setNotice;
  useEffect(() => {
    if (notice !== null) {
      showToast(notice, 'notice');
      clearNotice(null);
    }
  }, [notice, clearNotice]);

  return (
    <View className="flex-1">
      {/* In select mode the taps belong to selecting, so the quote stays plain. */}
      <ChatNoticeProvider notify={screen.setNotice}>
        <ChatJumpProvider jumpTo={screen.selectedIds.length > 0 ? undefined : screen.jumpTo}>
          <MessageList
            chat={chat}
            onReply={screen.startReply}
            onReact={(message, emoji) => react(chat.id, message.id, emoji)}
            onEdit={(message) => startEdit(chat.id, message.id)}
            onDelete={(message) => deleteForEveryone(chat.id, message.id)}
            onForward={forward}
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
        </ChatJumpProvider>
      </ChatNoticeProvider>
      <Toast toast={toast} onDismiss={dismissToast} />
    </View>
  );
}
