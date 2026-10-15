import type { Question } from '@zilar/protocol';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The AI's question card on the phone (T-1578): the question, then its 2-4 reply
 * chips in a wrapping row. A chip sends a normal reply that @mentions the asking
 * AI and quotes the question; after one tap the chips disable until the server
 * closes the question (step 6). No status words: plain outline pills.
 */
export function QuestionCard({ question }: { question: Question }) {
  const sendText = useChatStore((state) => state.sendText);
  // `PayloadCard` only sees the card, so the owning message is resolved here:
  // it carries the chat id and the message id the reply quotes.
  const message = useChatStore((state) => {
    const chatId = state.activeChatId;
    if (chatId === null) {
      return undefined;
    }
    return state.messages(chatId).find((entry) => {
      const card = entry.card;
      return card?.type === 'question' && card.data.id === question.id;
    });
  });
  const [answered, setAnswered] = useState(false);
  const disabled = answered || message === undefined;

  const answer = (option: string): void => {
    if (message === undefined || answered) {
      return;
    }
    setAnswered(true);
    const aiName = message.senderName;
    sendText(message.chatId, `@${aiName} ${option}`, {
      replyTo: { id: message.id, senderName: aiName },
      mentions: [{ jid: question.ai, name: aiName, begin: 0, end: aiName.length + 1 }],
    });
  };

  return (
    <View className="gap-2 py-0.5">
      <Text className="text-[15px] text-foreground">{question.question}</Text>
      <View className="flex-row flex-wrap gap-2">
        {question.options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            disabled={disabled}
            onPress={() => answer(option)}
            className={cn(
              'rounded-full border border-divider px-3.5 py-1.5',
              disabled ? 'opacity-50' : 'active:bg-surface-raised',
            )}
          >
            <Text className="text-[15px] font-medium text-foreground">{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
