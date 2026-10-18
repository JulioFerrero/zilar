import { isTopicJoined } from '@zilar/chat-core';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { AiStatusLine } from '@/components/chat/ai-status-line';
import { ChatBackground } from '@/components/chat/chat-background';
import { ChatComposerDock } from '@/components/chat/chat-composer-dock';
import { ChatHeaderBar } from '@/components/chat/chat-header-bar';
import { ChatOverlays } from '@/components/chat/chat-overlays';
import { ChatThread } from '@/components/chat/chat-thread';
import { composerBarFor } from '@/components/chat/composer-mentions';
import { PinnedBanner } from '@/components/chat/pinned-banner';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { TopicInfoHost } from '@/components/chat/topic-info-host';
import { TopicJoinView } from '@/components/chat/topic-join-view';
import { useChatScreen } from '@/components/chat/use-chat-screen';
import { StateMessage } from '@/components/ui/state-message';
import { goBackOrHome } from '@/lib/navigation';

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
        <StateMessage
          kind="empty"
          title="Chat not found"
          hint="It may have been deleted or you left it."
          action={{
            label: 'Back to chats',
            onPress: () => goBackOrHome(screen.router),
            accessibilityLabel: 'Back to chats',
          }}
        />
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
  } = screen;

  // T-1798: a public topic the caller has not joined shows its recent messages
  // read-only with one Join key instead of the thread and the composer. An
  // unknown caller id or member list keeps the normal thread (never a wrong
  // Join key).
  const joinPreview =
    chat.topic !== undefined &&
    chat.topic.visibility === 'public' &&
    !chat.topic.isGeneral &&
    screen.myUserId !== '' &&
    chat.topic.memberIds !== undefined &&
    !isTopicJoined(chat.topic, screen.myUserId);

  const headerProps = {
    chat,
    onBack: () => goBackOrHome(router),
    onSearchInChat: () => router.push({ pathname: '/', params: { searchChat: chat.id } }),
    onOpenMedia: () => setMediaOpen(true),
    onOpenGroup: openGroup,
  };

  const pinnedBanner = (
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
  );

  // T-0144: a channel feed opens like any topic row (the feed IS the General
  // topic); only the bottom bar differs (read-only for subscribers). A legacy
  // group row (older server, no topics) uses the full composer with the `@`
  // picker (T-0227 S1), like the topic path; channels keep their feed bar, DMs
  // keep today's text-only send.
  if (!isTopic || chat.chatKind === 'channel') {
    const legacyComposer = composerBarFor(chat) === 'composer';
    const variant =
      chat.chatKind === 'channel' ? 'channel' : legacyComposer ? 'composer' : 'channel';
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <ChatHeaderBar {...headerProps} />
        {pinnedBanner}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ChatThread screen={screen} chat={chat} />
          <ChatComposerDock screen={screen} chat={chat} variant={variant} />
        </KeyboardAvoidingView>
        <ChatOverlays screen={screen} chat={chat} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ChatBackground />
      <ChatHeaderBar {...headerProps} topicGroupName={groupName} onOpenInfo={openInfo} />
      {pinnedBanner}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {joinPreview ? (
          <TopicJoinView key={chat.id} chat={chat} />
        ) : (
          <>
            <View className="flex-1">
              <ChatThread screen={screen} chat={chat} />
              <View
                pointerEvents="box-none"
                className="absolute bottom-1.5 left-0 right-0 items-center px-3"
              >
                <AiStatusLine chat={chat} />
              </View>
            </View>
            <ChatComposerDock screen={screen} chat={chat} variant="composer" />
          </>
        )}
      </KeyboardAvoidingView>
      <TopicInfoHost screen={screen} chat={chat} />
      <ChatOverlays screen={screen} chat={chat} />
    </View>
  );
}
