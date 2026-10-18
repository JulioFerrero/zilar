import type { Payload, Progress, Sticker } from '@zilar/protocol';
import { StickerSchema, isValid } from '@zilar/protocol';
import { isCardAllowedFrom } from '@zilar/client-core';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ApprovalCard } from '@/components/chat/approval-card';
import { type BlockRespondTarget } from '@/components/chat/blocks/block-respond';
import { BlockCard } from '@/components/chat/blocks/block-card';
import { ProgressCard } from '@/components/chat/progress-card';
import { QuestionCard } from '@/components/chat/question-card';
import { bubbleStyle } from '@/lib/depth';

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
