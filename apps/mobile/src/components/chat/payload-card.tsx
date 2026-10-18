import {
  type Payload,
  type Progress,
  type Sticker,
  type Question,
  StickerSchema,
  isValid,
} from '@zilar/protocol';
import { isCardAllowedFrom } from '@zilar/client-core';
import { type ReactNode, useState } from 'react';
import { View, Pressable } from 'react-native';
import { ApprovalCard } from '@/components/chat/approval-card';
import type { BlockRespondTarget } from '@/components/chat/blocks/block-respond';
import { BlockCard } from '@/components/chat/blocks/block-card';
import { ProgressCard } from '@/components/chat/progress-card';
import { bubbleStyle } from '@/lib/depth';
import { answeredOption, isQuestionAnswer } from '@zilar/chat-core';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

// The AI's question card: the question, then 2-4 reply chips. A chip sends a normal reply that @mentions the asking AI and quotes the question; after one tap the chips disable until the server closes the question. After a reload the answer is read back from the first loaded reply that quotes it.
function QuestionCard({ question }: { question: Question }) {
  const sendText = useChatStore((state) => state.sendText);
  // `PayloadCard` only sees the card, so the owning message is resolved here for the chat and message ids the reply quotes.
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
  const reply = useChatStore((state) => {
    if (message === undefined) {
      return undefined;
    }
    return state.messages(message.chatId).find((entry) => isQuestionAnswer(entry, message));
  });
  const [answered, setAnswered] = useState(false);
  const picked =
    reply === undefined || message === undefined
      ? undefined
      : answeredOption(reply.text, message.senderName, question.options);
  const isAnswered = answered || reply !== undefined;
  const disabled = isAnswered || message === undefined;

  const answer = (option: string): void => {
    if (message === undefined || isAnswered) {
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
              isAnswered && option === picked
                ? 'border-transparent bg-surface-raised'
                : isAnswered
                  ? 'opacity-50'
                  : 'active:bg-surface-raised',
            )}
          >
            <Text className="text-[15px] font-medium text-foreground">{option}</Text>
          </Pressable>
        ))}
      </View>
      {reply !== undefined && (
        <Text className="text-[13px] text-muted-foreground">{reply.senderName} answered</Text>
      )}
    </View>
  );
}

// Parses a `sticker` payload whose `data` passes `StickerSchema`; anything invalid falls back to the body text, so a hostile or drifted payload never breaks the list.
export function stickerOf(message: {
  card?: { type: string; data: unknown; v?: number } | undefined;
}): Sticker | undefined {
  const { card } = message;
  if (card === undefined || card.type !== 'sticker') {
    return undefined;
  }
  return isValid(StickerSchema)(card.data) ? card.data : undefined;
}

// The progress card alone: it renders without a bubble, like a sticker, so it carries the incoming surface itself and shows no time or "edited" row.
function ProgressCardSurface({ data }: { data: Progress }) {
  return (
    <View className="min-w-[240px] rounded-[12px] p-2.5" style={bubbleStyle('incoming', false)}>
      <ProgressCard data={data} />
    </View>
  );
}

export function PayloadCard({
  card,
  senderId,
  footer,
  respond,
  preview = false,
}: {
  card: Payload;
  // The sender of the message this card came on; the AI-only gate needs it. A preview row passes none.
  senderId?: string | undefined;
  footer?: ReactNode;
  // Who answers a `blocks` card; absent on own cards.
  respond?: BlockRespondTarget;
  // A topic-join preview row has no store message, so it draws only the display-only cards.
  preview?: boolean;
}) {
  const previewCard = preview && (card.type === 'blocks' || card.type === 'progress');
  // An AI-only card never renders unless its sender resolves to an AI, even when a caller bypassed the ledger's mapping. An unknown sender fails closed and falls back to text.
  if (preview ? !previewCard : senderId === undefined || !isCardAllowedFrom(card, senderId)) {
    return null;
  }
  switch (card.type) {
    case 'progress':
      return <ProgressCardSurface data={card.data} />;
    case 'approval.request':
      return <ApprovalCard data={card.data} senderId={senderId} />;
    case 'question':
      return <QuestionCard question={card.data} />;
    case 'blocks':
      return <BlockCard data={card.data} footer={footer} respond={respond} />;
    default:
      return null;
  }
}

// The card types `PayloadCard` draws; any other payload (`handoff.line`, a card from a newer build) falls through to the normal text body instead of an empty bubble.
const RENDERED_CARD_TYPES: ReadonlySet<string> = new Set([
  'progress',
  'approval.request',
  'question',
  'blocks',
]);

export function isRenderedCard(card: { type: string }): boolean {
  return RENDERED_CARD_TYPES.has(card.type);
}
