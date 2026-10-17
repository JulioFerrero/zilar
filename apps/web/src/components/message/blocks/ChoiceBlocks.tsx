import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { ButtonsBlock } from './ButtonsBlock';
import { ChoiceBlock } from './ChoiceBlock';
import { FormBlock } from './FormBlock';
import { PollBlock } from './PollBlock';
import { RatingBlock } from './RatingBlock';

/**
 * The choice group's one dispatch point: `buttons` (13), `poll` (14), `choice`
 * (15), `form` (16) and `rating` (17). The bodies follow the board
 * `docs/design/mockups/blocks/WebChoices.dc.html`; the form takes `showHeading`
 * so a card header never repeats its title. Each body reads `BlockRespond` and
 * draws its controls disabled when there is no provider (fixtures, own cards).
 */
export function renderChoiceBlock(
  block: Extract<Block, { kind: 'buttons' | 'poll' | 'choice' | 'form' | 'rating' }>,
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
  }
}
