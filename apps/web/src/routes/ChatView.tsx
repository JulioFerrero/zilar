import {
  isTopicJoined,
  replyRef,
  type ChatSummary,
  type ReplyRef,
  type UiMessage,
} from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  useCallback,
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
  type ReactNode,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AiPanel } from '@/components/ais/AiPanel';
import { AiStatusLine } from '@/components/topic/AiStatusLine';
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
import { MediaViewerProvider } from '@/components/media/MediaViewer';
import { SelectionBar } from '@/components/SelectionBar';
import { PinnedBanner } from '@/components/PinnedBanner';
import { PinsPanel } from '@/components/PinsPanel';
import { StepsPanel } from '@/components/StepsPanel';
import { TopicPanel } from '@/components/TopicPanel';
import { TopicJoinView } from '@/components/topic/TopicJoinView';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { runWeb } from '@/lib/effect/runtime';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useMuteToggle } from '@/components/useMuteToggle';

/** Subscribers see a read-only bar; the moderated room enforces posting, not this bar. */
function ChannelComposerBar({
  chat,
  replyTo,
  onCancelReply,
}: {
  chat: ChatSummary;
  replyTo?: ReplyRef;
  onCancelReply?: () => void;
}) {
  const info = useChatSelector((s) => s.groupInfo(chat.id));
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const { muted, busy, error, toggle } = useMuteToggle(chat);

  // Unknown role means subscriber (read-only) until proven otherwise.
  const role = chat.myRole ?? info?.members.find((member) => member.userId === currentUserId)?.role;
  const canPost = role === 'owner' || role === 'admin';

  if (canPost) {
    return (
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={onCancelReply ?? (() => {})} />
    );
  }

  return (
    <div className="pointer-events-none relative px-3 pt-2 pb-3 *:pointer-events-auto wide:px-8 wide:pt-3 wide:pb-5">
      <div className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
          Only admins can post here
        </p>
        <Button type="button" variant="ghost" className="shrink-0" disabled={busy} onClick={toggle}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-1 px-1 text-[12px] text-danger">
          Could not change the mute. Try again.
        </p>
      )}
    </div>
  );
}

function useMessageSelection({
  chatId,
  storeApi,
  setForwarding,
}: {
  chatId: string;
  storeApi: ReturnType<typeof useChatStoreApi>;
  setForwarding: Dispatch<SetStateAction<UiMessage[] | null>>;
}) {
  // The ids checked in select mode; null means not selecting. Reset on chat change so a selection never leaks.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [selectionChatId, setSelectionChatId] = useState(chatId);
  if (selectionChatId !== chatId) {
    setSelectionChatId(chatId);
    setSelectedIds(null);
  }

  const startSelect = useCallback((message: UiMessage): void => {
    setSelectedIds([message.id]);
  }, []);

  const toggleSelect = useCallback((message: UiMessage): void => {
    setSelectedIds((current) => {
      if (current === null) {
        return current;
      }
      return current.includes(message.id)
        ? current.filter((id) => id !== message.id)
        : [...current, message.id];
    });
  }, []);

  const selection = useMemo(
    () => ({ ids: new Set(selectedIds ?? []), onToggle: toggleSelect, onStart: startSelect }),
    [selectedIds, toggleSelect, startSelect],
  );

  const forwardSelected = (): void => {
    if (selectedIds === null) {
      return;
    }
    const ids = new Set(selectedIds);
    setForwarding(
      storeApi
        .getState()
        .messages(chatId)
        .filter((message) => ids.has(message.id)),
    );
    setSelectedIds(null);
  };

  return { selectedIds, setSelectedIds, selection, forwardSelected };
}

/** Overlays the list and publishes its height as `--composer-h` so the list pads around it. */
function ComposerDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dock = ref.current;
    if (dock === null) {
      return;
    }
    const host = dock.parentElement;
    if (host === null) {
      return;
    }
    const publish = (): void => {
      host.style.setProperty('--composer-h', `${dock.offsetHeight}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      host.style.removeProperty('--composer-h');
    };
  }, []);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
      {children}
    </div>
  );
}

type OpenPanel = 'ai' | 'group' | 'topic' | 'contact';

function initialPanel(value: string | null, chat: ChatSummary): OpenPanel | undefined {
  if (value === 'ai' && chat.isAI) {
    return 'ai';
  }
  // The channel feed opens the channel panel, not the topic panel.
  if (value === 'topic' && chat.topic !== undefined && chat.chatKind !== 'channel') {
    return 'topic';
  }
  if (value === 'group' && (chat.groupId !== undefined || chat.kind === 'group')) {
    return 'group';
  }
  if (value === 'group' && chat.chatKind === 'channel') {
    return 'group';
  }
  // A DM that is not an AI opens the contact info panel.
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
  // Switching chats closes the open panel so it can never leak from one chat to the next.
  const [panelChatId, setPanelChatId] = useState(chat.id);
  if (panelChatId !== chat.id) {
    setPanelChatId(chat.id);
    setPanel(initialPanel(searchParams.get('panel'), chat));
  }
  // The media panel resets like the info panel when the chat changes, so it cannot leak.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaChatId, setMediaChatId] = useState(chat.id);
  if (mediaChatId !== chat.id) {
    setMediaChatId(chat.id);
    setMediaOpen(false);
  }
  const isWide = useMediaQuery('(min-width: 900px)');
  const [searchOpen, setSearchOpen] = useState(false);
  const startChatSearch = (): void => {
    if (!isWide) {
      setSearchOpen(true);
      return;
    }
    storeApi.getState().setSearchChat(chat.id);
    // Focus after a zero-delay macrotask so the scope chip is already painted.
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
  // Edit mode and reply are exclusive: starting an edit clears the reply. The reset happens
  // during render, like the composer's chat-switch reset.
  const [lastEditTarget, setLastEditTarget] = useState(editTarget);
  if (editTarget !== lastEditTarget) {
    setLastEditTarget(editTarget);
    if (editTarget !== undefined) {
      setReplyTo(undefined);
    }
  }

  useEffect(() => {
    storeApi.getState().openChat(chat.id);
    // Leaving the chat clears the open chat, so an arriving message is not marked seen.
    return () => {
      storeApi.getState().closeChat(chat.id);
    };
  }, [storeApi, chat.id]);

  // Typing with nothing focused lands in the composer: only a printable key aimed at the
  // page body, with no Ctrl/Meta/Alt, is forwarded.
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

  // The message list is memoised, so every callback and prop it gets has a stable identity.
  const startReply = useCallback(
    (message: UiMessage): void => {
      storeApi.getState().cancelEdit();
      setReplyTo(replyRef(message, currentUserId));
    },
    [storeApi, currentUserId],
  );

  const forwardOne = useCallback(
    (message: UiMessage): void => {
      // Forwarding an album bubble forwards the whole album in index order, as one grid.
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
  // The Steps panel opens only for a card in this chat; a leftover or bad steps param is dropped.
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

  // The group panel opens for every group, topics included; a topic row is handed the
  // group's General topic. A legacy group row carries no groupId, so keep its own row.
  const groupChat =
    chat.groupId !== undefined && chat.topic !== undefined
      ? (chats.find((entry) => entry.groupId === chat.groupId && entry.topic?.isGeneral === true) ??
        chat)
      : chat.kind === 'group'
        ? chat
        : undefined;

  const contactChat = chat.kind === 'dm' && !chat.isAI ? chat : undefined;

  // A public topic the viewer has not joined reads read-only, with one Join key instead of the
  // composer. While the viewer's id or the member list is unknown, keep the normal thread so
  // a member never sees a Join key.
  const joinPreview =
    chat.topic !== undefined &&
    chat.topic.visibility === 'public' &&
    chat.topic.isGeneral !== true &&
    currentUserId !== '' &&
    chat.topic.memberIds !== undefined &&
    !isTopicJoined(chat.topic, currentUserId);

  // Pins load when the chat opens; the store refreshes them on focus and every 60 s.
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
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessageList
              key={chat.id}
              chat={chat}
              onReply={startReply}
              onForward={forwardOne}
              selection={selection}
              selecting={selectedIds !== null}
            />
            <ComposerDock>
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
                    <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center px-3 wide:px-8 *:pointer-events-auto">
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
            </ComposerDock>
          </div>
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
