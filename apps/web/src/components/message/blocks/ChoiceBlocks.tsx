import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { AlertBlock } from './AlertBlock';
import { ButtonsBlock } from './ButtonsBlock';
import { ChoiceBlock } from './ChoiceBlock';
import { FormBlock } from './FormBlock';
import { PollBlock } from './PollBlock';
import { RatingBlock } from './RatingBlock';

export function renderChoiceBlock(
  block: Extract<Block, { kind: 'buttons' | 'poll' | 'choice' | 'form' | 'rating' | 'alert' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'buttons':
      return <ButtonsBlock block={block} />;
    case 'poll':
      return <PollBlock block={block} />;
    case 'choice':
      return <ChoiceBlock block={block} />;
    case 'form':
      return <FormBlock block={block} showHeading={showHeading} />;
    case 'rating':
      return <RatingBlock block={block} />;
    case 'alert':
      return <AlertBlock block={block} showHeading={showHeading} />;
  }
}
