import { isTopicJoined, type ChatSummary, type ReplyRef, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AiPanel } from '@/components/ais/AiPanel';
import { AiStatusLine } from '@/components/topic/AiStatusLine';
import { ChannelComposerBar } from '@/components/ChannelComposerBar';
import { ChannelPanel } from '@/components/ChannelPanel';
import { ChatHeader } from '@/components/ChatHeader';
import { ChatMediaPanel } from '@/components/ChatMediaPanel';
import { ChatSearchBar } from '@/components/ChatSearchBar';
import { Composer } from '@/components/Composer';
import { focusComposer } from '@/components/composer/useComposerFocus';
import { ForwardPicker } from '@/components/ForwardPicker';
import { Button } from '@/components/ui/button';
import { ContactPanel } from '@/components/ContactPanel';
import { GroupPanel } from '@/components/GroupPanel';
import { MessageList } from '@/components/MessageList';
import { useMessageSelection } from '@/components/useMessageSelection';
import { MediaViewerProvider } from '@/components/media/MediaViewer';
import { SelectionBar } from '@/components/SelectionBar';
import { PinnedBanner } from '@/components/PinnedBanner';
import { PinsPanel } from '@/components/PinsPanel';
import { StepsPanel } from '@/components/StepsPanel';
import { TopicPanel } from '@/components/TopicPanel';
import { TopicJoinView } from '@/components/topic/TopicJoinView';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { runWeb } from '@/lib/effect/runtime';
import { replyRef } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';

type OpenPanel = 'ai' | 'group' | 'topic' | 'contact';

function initialPanel(value: string | null, chat: ChatSummary): OpenPanel | undefined {
  if (value === 'ai' && chat.isAI) {
    return 'ai';
  }
  // T-0124: the channel feed opens the channel panel, not the topic panel.
  if (value === 'topic' && chat.topic !== undefined && chat.chatKind !== 'channel') {
    return 'topic';
  }
  if (value === 'group' && (chat.groupId !== undefined || chat.kind === 'group')) {
    return 'group';
  }
  if (value === 'group' && chat.chatKind === 'channel') {
    return 'group';
  }
  // T-1323: a DM that is not an AI opens the contact info panel.
  if (value === 'contact' && chat.kind === 'dm' && !chat.isAI) {
    return 'contact';
  }
  return undefined;
}

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const editTarget = useChatSelector((s) => s.editTarget);
  const topicNotice = useChatSelector((s) => s.topicNotice);
  const storedPinsPanel = useChatSelector((s) => s.pinsPanel);
  const chats = useChatSelector((s) => s.chats);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState<OpenPanel | undefined>(() =>
    initialPanel(searchParams.get('panel'), chat),
  );
  // Switching chats closes the open panel, unless the new URL still asks for
  // one. ChatShell keys ChatView by chat id, but the reset is explicit so the
  // panel can never leak from one chat to the next.
  const [panelChatId, setPanelChatId] = useState(chat.id);
  if (panelChatId !== chat.id) {
    setPanelChatId(chat.id);
    setPanel(initialPanel(searchParams.get('panel'), chat));
  }
  // The media panel is opened from the header menu, not the URL; it resets
  // like the info panel when the chat changes so it cannot leak between chats.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaChatId, setMediaChatId] = useState(chat.id);
  if (mediaChatId !== chat.id) {
    setMediaChatId(chat.id);
    setMediaOpen(false);
  }
  // T-1323: the narrow in-chat search bar replaces the header (WUX-34), so it
  // lives here; the header and the contact panel's Search key both start it.
  const isWide = useMediaQuery('(min-width: 900px)');
  const [searchOpen, setSearchOpen] = useState(false);
  const startChatSearch = (): void => {
    if (!isWide) {
      setSearchOpen(true);
      return;
    }
    storeApi.getState().setSearchChat(chat.id);
    // The list search box lives outside this view; focus it after a zero-delay
    // macrotask so the scope chip is already painted.
    void runWeb(
      Effect.sleep(0).pipe(
        Effect.andThen(Effect.sync(() => window.dispatchEvent(new Event('zilar:focus-search')))),
      ),
    );
  };
  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);
  const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);
  const { selectedIds, setSelectedIds, selection, forwardSelected } = useMessageSelection({
    chatId: chat.id,
    storeApi,
    setForwarding,
  });
  // Edit mode and reply are exclusive: starting an edit clears the reply. The
  // reset happens during render (React's "adjust state when a prop changes"),
  // like the composer's chat-switch reset.
  const [lastEditTarget, setLastEditTarget] = useState(editTarget);
  if (editTarget !== lastEditTarget) {
    setLastEditTarget(editTarget);
    if (editTarget !== undefined) {
      setReplyTo(undefined);
    }
  }

  useEffect(() => {
    storeApi.getState().openChat(chat.id);
    // Leaving the chat (or switching to another one) clears the open chat, so
    // a message arriving on the list is not marked seen (T-1147).
    return () => {
      storeApi.getState().closeChat(chat.id);
    };
  }, [storeApi, chat.id]);

  // Typing with nothing focused lands in the composer (WUX-6), as in Telegram:
  // only a printable key aimed at the page body, with no Ctrl/Meta/Alt, forwards
  // the focus so the key itself lands in the textarea.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target !== document.body) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key.length !== 1) {
        return;
      }
      focusComposer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The message list is memoised, so every callback and prop it gets here has a
  // stable identity until the thing it depends on changes.
  const startReply = useCallback(
    (message: UiMessage): void => {
      storeApi.getState().cancelEdit();
      setReplyTo(replyRef(message, currentUserId));
    },
    [storeApi, currentUserId],
  );

  const forwardOne = useCallback(
    (message: UiMessage): void => {
      // T-1273: forwarding an album bubble forwards the whole album (its
      // photos, in `index` order), so it arrives in the target as one grid. A
      // lone photo, as before, forwards just itself.
      const album = message.album;
      if (album === undefined) {
        setForwarding([message]);
        return;
      }
      setForwarding(
        storeApi
          .getState()
          .messages(chat.id)
          .filter((item) => item.album?.id === album.id && item.senderId === message.senderId)
          .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0)),
      );
    },
    [storeApi, chat.id],
  );

  const cancelReply = (): void => {
    setReplyTo(undefined);
  };

  const notice = topicNotice?.chatId === chat.id ? topicNotice : undefined;
  const pinsPanel = storedPinsPanel?.chatId === chat.id ? storedPinsPanel : undefined;
  // T-1535: the Steps panel opens only for a card in this chat; a leftover or
  // bad `steps` param mounts nothing and is dropped. Close keeps the rest.
  const stepsTaskId = searchParams.get('steps');
  const stepsCard = useChatSelector((state) =>
    state.messagesByChat[chat.id]?.some(
      (message) => message.card?.type === 'progress' && message.card.data.task_id === stepsTaskId,
    ),
  );
  const closeSteps = useCallback((): void => {
    const next = new URLSearchParams(searchParams);
    next.delete('steps');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (stepsTaskId !== null && stepsCard === false) {
      closeSteps();
    }
  }, [stepsTaskId, stepsCard, closeSteps]);

  // T-1249: the group panel opens for every group, topics included. A topic
  // row is not the group's chat, so hand the panel the group's General topic
  // (same groupId); a legacy group row carries no groupId, so fall back to its
  // kind and keep its own row. The panel reads the group title from the row's
  // `groupTitle`.
  const groupChat =
    chat.groupId !== undefined && chat.topic !== undefined
      ? (chats.find((entry) => entry.groupId === chat.groupId && entry.topic?.isGeneral === true) ??
        chat)
      : chat.kind === 'group'
        ? chat
        : undefined;

  // T-1323: a DM that is not an AI opens the contact info panel.
  const contactChat = chat.kind === 'dm' && !chat.isAI ? chat : undefined;

  // T-1797: a public topic the viewer has not joined reads read-only, with one
  // Join key instead of the composer (W9). General is everyone's topic.
  // T-1811: while the viewer's id or the member list is unknown, keep the
  // normal thread — a member must never see a Join key.
  const joinPreview =
    chat.topic !== undefined &&
    chat.topic.visibility === 'public' &&
    chat.topic.isGeneral !== true &&
    currentUserId !== '' &&
    chat.topic.memberIds !== undefined &&
    !isTopicJoined(chat.topic, currentUserId);

  // Pins load when the chat opens (the store also refreshes them on focus
  // and every 60 s while the chat is open; there is no realtime channel yet).
  useEffect(() => {
    void storeApi.getState().loadPins(chat.id);
  }, [storeApi, chat.id]);

  return (
    <MediaViewerProvider>
      <div className="flex h-full min-h-0 flex-col">
        {searchOpen && !isWide ? (
          <ChatSearchBar chat={chat} onClose={() => setSearchOpen(false)} />
        ) : (
          <ChatHeader
            chat={chat}
            onSearch={startChatSearch}
            onOpenMedia={() => setMediaOpen(true)}
            {...(chat.isAI ? { onOpenAiPanel: () => setPanel('ai') } : {})}
            {...(groupChat !== undefined ? { onOpenGroupPanel: () => setPanel('group') } : {})}
            {...(chat.topic !== undefined ? { onOpenTopicPanel: () => setPanel('topic') } : {})}
            {...(contactChat !== undefined
              ? { onOpenContactPanel: () => setPanel('contact') }
              : {})}
          />
        )}
        <PinnedBanner chatId={chat.id} />
        {notice !== undefined && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-divider bg-panel px-4 py-2">
            <p role="status" className="text-[13px] text-muted-foreground">
              {notice.message}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Dismiss notice"
              onClick={() => storeApi.getState().dismissTopicNotice()}
              className="shrink-0 rounded-full text-[13px] text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
        )}
        {joinPreview ? (
          <TopicJoinView key={chat.id} chat={chat} />
        ) : (
          <>
            <MessageList
              key={chat.id}
              chat={chat}
              onReply={startReply}
              onForward={forwardOne}
              selection={selection}
              selecting={selectedIds !== null}
            />
            {selectedIds !== null ? (
              <SelectionBar
                chat={chat}
                selectedIds={selectedIds}
                onForward={forwardSelected}
                onCancel={() => setSelectedIds(null)}
              />
            ) : chat.chatKind === 'channel' ? (
              <ChannelComposerBar chat={chat} />
            ) : (
              <>
                <div className="relative z-10 h-0">
                  <div className="absolute inset-x-0 bottom-1.5 flex justify-center px-3 wide:px-8">
                    <AiStatusLine chat={chat} />
                  </div>
                </div>
                <Composer
                  chatId={chat.id}
                  replyTo={replyTo}
                  onCancelReply={cancelReply}
                  onOpenStickersSettings={() => navigate('/settings/stickers')}
                />
              </>
            )}
          </>
        )}
        {panel === 'ai' && chat.isAI && <AiPanel chat={chat} onClose={() => setPanel(undefined)} />}
        {panel === 'group' && groupChat !== undefined && chat.chatKind !== 'channel' && (
          <GroupPanel
            key={`group:${groupChat.id}`}
            chat={groupChat}
            onClose={() => setPanel(undefined)}
            onSearch={() => {
              setPanel(undefined);
              startChatSearch();
            }}
            onOpenMedia={() => {
              setPanel(undefined);
              setMediaOpen(true);
            }}
          />
        )}
        {panel === 'topic' && chat.topic !== undefined && chat.chatKind !== 'channel' && (
          <TopicPanel
            chat={chat}
            {...(groupChat !== undefined ? { onOpenGroup: () => setPanel('group') } : {})}
            onClose={() => setPanel(undefined)}
          />
        )}
        {panel === 'group' && chat.chatKind === 'channel' && (
          <ChannelPanel
            chat={chat}
            onClose={() => setPanel(undefined)}
            onSearch={() => {
              setPanel(undefined);
              startChatSearch();
            }}
            onOpenMedia={() => {
              setPanel(undefined);
              setMediaOpen(true);
            }}
          />
        )}
        {panel === 'contact' && contactChat !== undefined && (
          <ContactPanel
            key={`contact:${contactChat.id}`}
            chat={contactChat}
            onClose={() => setPanel(undefined)}
            onSearch={() => {
              setPanel(undefined);
              startChatSearch();
            }}
            onOpenMedia={() => {
              setPanel(undefined);
              setMediaOpen(true);
            }}
          />
        )}
        {pinsPanel !== undefined && (
          <PinsPanel chatId={chat.id} onClose={() => storeApi.getState().setPinsPanel(undefined)} />
        )}
        {stepsTaskId !== null && stepsCard === true && (
          <StepsPanel chatId={chat.id} taskId={stepsTaskId} onClose={closeSteps} />
        )}
        {mediaOpen && <ChatMediaPanel chatId={chat.id} onClose={() => setMediaOpen(false)} />}
        {forwarding !== null && (
          <ForwardPicker messages={forwarding} onClose={() => setForwarding(null)} />
        )}
      </div>
    </MediaViewerProvider>
  );
}
