import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { MessageList } from '@/components/chat/message-list';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { useVoicePlayerHost } from '@/components/chat/voice-player';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { API_URL } from '@/lib/auth';
import { mediaUrl } from '@/lib/attachment-common';
import { createAttachmentOpener } from '@/lib/attachment-native';
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

/**
 * The message list and one transient toast for its failures (T-1289/MUX-32).
 * The toast replaces the stacked `DismissBanner`s: a new message replaces the
 * current one and clears itself, so the list never gets pushed up. One copy
 * replaces the three identical `MessageList` + banner blocks the screen
 * repeated.
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
  const storeApi = useChatStoreApi();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // A new id on every show restarts the toast timer even for identical text.
  const toastSeq = useRef(0);
  const [openingId, setOpeningId] = useState<string | undefined>(undefined);
  // One transient message at a time: a new one replaces the current.
  const showToast = (text: string, tone: 'error' | 'notice' = 'error') => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  };
  const dismissToast = useCallback(() => setToast(null), []);
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
  const voiceHost = useVoicePlayerHost(chat.id);

  const openAttachment = (message: UiMessage) => {
    const attachment = message.attachment;
    if (attachment === undefined) {
      return;
    }
    // Untrusted or non-http(s) addresses never open: only the server-served
    // upload URL (under the 50 MiB cap, like any attachment) goes to the
    // system sheet. The upload URL is routed through `GET /api/files` (T-1185)
    // so the download carries the session bearer; the opener's own origin
    // guard keeps that bearer off any other host.
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

  // T-1274: forwarding an album bubble forwards the whole album (its photos,
  // in `index` order, like web's `forwardOne`), so it arrives in the target as
  // one grid. A lone photo, as before, forwards just itself.
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

  // A store action failure (a failed edit, delete or reaction) arrives once:
  // copy it into the toast and clear the store so it cannot stack.
  useEffect(() => {
    if (actionError !== undefined) {
      showToast(actionError.message);
      dismissActionError();
    }
  }, [actionError, dismissActionError]);

  // A search jump that found no message: a quiet notice, not an error.
  useEffect(() => {
    if (screen.jumpMissed) {
      showToast('Message not found', 'notice');
      screen.setJumpMissed(false);
    }
  }, [screen]);

  // A partial AI create lands here with `?notice=partial`: a quiet notice shown
  // once, mirroring the search-jump miss above.
  const partialNotice = screen.partialNotice;
  const clearPartialNotice = screen.setPartialNotice;
  useEffect(() => {
    if (partialNotice) {
      showToast('AI created. Some settings could not be saved.', 'notice');
      clearPartialNotice(false);
    }
  }, [partialNotice, clearPartialNotice]);

  return (
    <View className="flex-1">
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
      <Toast toast={toast} onDismiss={dismissToast} />
    </View>
  );
}
