import { KeyboardAvoidingView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatBackground } from '@/components/chat/chat-background';
import { ChatComposerDock } from '@/components/chat/chat-composer-dock';
import { ChatHeaderBar } from '@/components/chat/chat-header-bar';
import { ChatOverlays } from '@/components/chat/chat-overlays';
import { ChatThread } from '@/components/chat/chat-thread';
import { composerBarFor } from '@/components/chat/composer-mentions';
import { PinnedBanner } from '@/components/chat/pinned-banner';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { TaskStrip } from '@/components/chat/task-strip';
import { TopicInfoHost } from '@/components/chat/topic-info-host';
import { useChatScreen } from '@/components/chat/use-chat-screen';
import { Text } from '@/components/ui/text';
import { httpsTopicUrl } from '@/lib/topics';

export default function ChatScreen() {
  return (
    <RequireAuth>
      <Chat />
    </RequireAuth>
  );
}

function Chat() {
  const screen = useChatScreen();
  const { chat, chatsLoad } = screen;

  if (!chat) {
    // The chats are still arriving: this is a loading state, not "not found".
    if (chatsLoad === 'loading') {
      return (
        <SafeAreaView className="flex-1 bg-background" edges={['top']}>
          <ChatBackground />
          <MessageListSkeleton />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={['top']}>
        <Text className="text-[15px] text-muted-foreground">Chat not found</Text>
      </SafeAreaView>
    );
  }

  const {
    isTopic,
    router,
    pins,
    pinsError,
    pinIndex,
    setPinIndex,
    jumpError,
    setJumpError,
    jumpToPin,
    setPinsOpen,
    dismissPinsError,
    setMediaOpen,
    groupName,
    openInfo,
    openGroup,
    statusOpen,
    setStatusOpen,
    chooseStatus,
    ownerOpen,
    setOwnerOpen,
    ownerCandidates,
    linkOpen,
    setLinkOpen,
    linkUrl,
    setLinkUrl,
    linkLabel,
    setLinkLabel,
    stripError,
    setStripError,
    patch,
  } = screen;

  if (!isTopic) {
    // A legacy group row (older server, no topics) uses the full composer
    // with the `@` picker (T-0227 S1), like the topic path; channels keep
    // their feed bar, DMs keep today's text-only send.
    const legacyComposer = composerBarFor(chat) === 'composer';
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <ChatHeaderBar
          chat={chat}
          onBack={() => router.back()}
          onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
          onOpenMedia={() => setMediaOpen(true)}
          onOpenGroup={openGroup}
        />
        <PinnedBanner
          pins={pins}
          pinsError={pinsError}
          index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
          jumpError={jumpError}
          onCycle={() => {
            setJumpError('');
            setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
          }}
          onTapPin={jumpToPin}
          onOpenList={() => setPinsOpen(true)}
          onDismissError={() => dismissPinsError()}
        />
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ChatThread screen={screen} chat={chat} />
          <ChatComposerDock
            screen={screen}
            chat={chat}
            variant={legacyComposer ? 'composer' : 'channel'}
          />
        </KeyboardAvoidingView>
        <ChatOverlays screen={screen} chat={chat} />
      </View>
    );
  }

  // T-0144: a channel feed opens like any topic row (the feed IS the General
  // topic); only the bottom bar differs (read-only for subscribers).
  if (!isTopic || chat.chatKind === 'channel') {
    const channelBar = chat.chatKind === 'channel';
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <ChatHeaderBar
          chat={chat}
          onBack={() => router.back()}
          onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
          onOpenMedia={() => setMediaOpen(true)}
          onOpenGroup={openGroup}
        />
        <PinnedBanner
          pins={pins}
          pinsError={pinsError}
          index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
          jumpError={jumpError}
          onCycle={() => {
            setJumpError('');
            setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
          }}
          onTapPin={jumpToPin}
          onOpenList={() => setPinsOpen(true)}
          onDismissError={() => dismissPinsError()}
        />
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ChatThread screen={screen} chat={chat} />
          <ChatComposerDock
            screen={screen}
            chat={chat}
            variant={channelBar ? 'channel' : 'composer'}
          />
        </KeyboardAvoidingView>
        <ChatOverlays screen={screen} chat={chat} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ChatBackground />
      <ChatHeaderBar
        chat={chat}
        onBack={() => router.back()}
        onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
        onOpenMedia={() => setMediaOpen(true)}
        topicGroupName={groupName}
        onOpenInfo={openInfo}
        onOpenGroup={openGroup}
      />
      <TaskStrip
        chat={chat}
        statusOpen={statusOpen}
        onToggleStatus={() => {
          setStatusOpen((value) => !value);
          setOwnerOpen(false);
          setLinkOpen(false);
        }}
        onChooseStatus={chooseStatus}
        ownerOpen={ownerOpen}
        onToggleOwner={() => {
          setOwnerOpen((value) => !value);
          setStatusOpen(false);
          setLinkOpen(false);
        }}
        onChooseOwner={(owner) => {
          setOwnerOpen(false);
          const current = chat.topic?.owner;
          const same =
            (owner === null && current === null) ||
            (owner !== null &&
              current !== null &&
              current !== undefined &&
              owner.kind === current.kind &&
              owner.id === current.id);
          if (same) {
            return;
          }
          patch({ owner: owner === null ? null : { kind: owner.kind, id: owner.id } });
        }}
        ownerCandidates={ownerCandidates}
        linkOpen={linkOpen}
        onToggleLink={() => {
          setLinkUrl(chat.topic?.linkUrl ?? '');
          setLinkLabel(chat.topic?.linkLabel ?? '');
          setLinkOpen((value) => !value);
          setStatusOpen(false);
          setOwnerOpen(false);
        }}
        linkUrl={linkUrl}
        linkLabel={linkLabel}
        onChangeLinkUrl={setLinkUrl}
        onChangeLinkLabel={setLinkLabel}
        onSaveLink={() => {
          const trimmed = linkUrl.trim();
          if (trimmed !== '' && httpsTopicUrl(trimmed) === undefined) {
            setStripError('Link must be an https URL.');
            return;
          }
          setLinkOpen(false);
          const nextUrl = trimmed === '' ? null : trimmed;
          const nextLabel = linkLabel.trim() === '' ? null : linkLabel.trim().slice(0, 40);
          patch({ linkUrl: nextUrl, linkLabel: nextLabel });
        }}
        error={stripError}
      />
      <PinnedBanner
        pins={pins}
        pinsError={pinsError}
        index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
        jumpError={jumpError}
        onCycle={() => {
          setJumpError('');
          setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
        }}
        onTapPin={jumpToPin}
        onOpenList={() => setPinsOpen(true)}
        onDismissError={() => dismissPinsError()}
      />
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ChatThread screen={screen} chat={chat} />
        <ChatComposerDock screen={screen} chat={chat} variant="composer" />
      </KeyboardAvoidingView>
      <TopicInfoHost screen={screen} chat={chat} />
      <ChatOverlays screen={screen} chat={chat} />
    </View>
  );
}
