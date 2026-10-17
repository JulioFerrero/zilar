import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { ButtonsBlock } from '@/components/chat/blocks/buttons-block';
import { ChoiceBlock } from '@/components/chat/blocks/choice-block';
import { FormBlock } from '@/components/chat/blocks/form-block';
import { PollBlock } from '@/components/chat/blocks/poll-block';
import { RatingBlock } from '@/components/chat/blocks/rating-block';

/** The interactive kinds the choice group draws on the phone. */
export const CHOICE_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'buttons',
  'poll',
  'choice',
  'form',
  'rating',
]);

/**
 * The choice group's one dispatch point: buttons (13), poll (14), pick one
 * (15), quick form (16) and rating (17), following the board
 * `docs/design/mockups/blocks/PhoneChoices.dc.html`.
 */
export function renderChoiceBlock(
  block: Extract<Block, { kind: 'buttons' | 'poll' | 'choice' | 'form' | 'rating' }>,
): ReactNode {
  switch (block.kind) {
    case 'buttons':
      return <ButtonsBlock block={block} />;
    case 'poll':
      return <PollBlock block={block} />;
    case 'choice':
      return <ChoiceBlock block={block} />;
    case 'form':
      return <FormBlock block={block} />;
    case 'rating':
      return <RatingBlock block={block} />;
  }
}
