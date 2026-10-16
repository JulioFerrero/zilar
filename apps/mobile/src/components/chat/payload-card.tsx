import type { Payload, Progress, Sticker } from '@zilar/protocol';
import { StickerSchema, isValid } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ApprovalCard } from '@/components/chat/approval-card';
import { BlockCard } from '@/components/chat/blocks/block-card';
import { ProgressCard } from '@/components/chat/progress-card';
import { QuestionCard } from '@/components/chat/question-card';
import { bubbleStyle } from '@/lib/depth';

/**
 * Parses the sticker card of a message: a `sticker` payload whose `data`
 * passes `StickerSchema`. Anything invalid falls back to the body text, so a
 * hostile or drifted payload never breaks the list.
 */
export function stickerOf(message: {
  card?: { type: string; data: unknown; v?: number } | undefined;
}): Sticker | undefined {
  const { card } = message;
  if (card === undefined || card.type !== 'sticker') {
    return undefined;
  }
  return isValid(StickerSchema)(card.data) ? card.data : undefined;
}

/**
 * The progress card alone (T-1619): it renders without a bubble, the way a
 * sticker does, so it carries the incoming surface itself and shows no time or
 * "edited" row under it.
 */
function ProgressCardSurface({ data }: { data: Progress }) {
  return (
    <View className="min-w-[240px] rounded-[12px] p-2.5" style={bubbleStyle('incoming', false)}>
      <ProgressCard data={data} />
    </View>
  );
}

/** Renders the AI card payloads from `@zilar/protocol`. */
export function PayloadCard({ card, footer }: { card: Payload; footer?: ReactNode }) {
  switch (card.type) {
    case 'progress':
      return <ProgressCardSurface data={card.data} />;
    case 'approval.request':
      return <ApprovalCard data={card.data} />;
    case 'question':
      return <QuestionCard question={card.data} />;
    case 'blocks':
      return <BlockCard data={card.data} footer={footer} />;
    default:
      return null;
  }
}

// T-1572: the card types `PayloadCard` actually draws.
// `message-bubble-content.tsx:182` takes the card branch only for these, so any
// other payload (a `handoff.line`, or a card a released build does not know
// yet) falls through to the normal text body instead of an empty bubble.
const RENDERED_CARD_TYPES: ReadonlySet<string> = new Set([
  'progress',
  'approval.request',
  'question',
  'blocks',
]);

export function isRenderedCard(card: { type: string }): boolean {
  return RENDERED_CARD_TYPES.has(card.type);
}
