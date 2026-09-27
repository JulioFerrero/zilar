import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '@/components/chat/chat-header';
import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { useChatStore } from '@/store/chat-store';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = typeof params.id === 'string' ? params.id : '';
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const chat = useChatStore((state) => state.chats.find((item) => item.id === chatId));
  const openChat = useChatStore((state) => state.openChat);
  const sendText = useChatStore((state) => state.sendText);

  useEffect(() => {
    if (chatId) {
      openChat(chatId);
    }
  }, [chatId, openChat]);

  if (!chat) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={['top']}>
        <Text className="text-[15px] text-muted-foreground">Chat not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND[scheme]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top']} className="bg-background">
        <ChatHeader chat={chat} onBack={() => router.back()} />
      </SafeAreaView>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <MessageList chat={chat} />
        <Composer onSend={(text) => sendText(chat.id, text)} />
      </KeyboardAvoidingView>
    </View>
  );
}
