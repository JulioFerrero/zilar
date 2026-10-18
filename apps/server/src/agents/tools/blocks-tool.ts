import { BlockIconSchema } from '@zilar/protocol';
import { cardGuide } from '../../message-blocks/guide';
import type { ChatToolDefinition } from './definitions';
import { POST_BLOCKS_TOOL } from './schemas';

const POST_BLOCKS_DESCRIPTION =
  'Post a small native card with numbers, lists or status — not for prose. `text` ' +
  'is the plain summary people see in previews and notifications; every other ' +
  'value is a pre-formatted display string and links must be https. ' +
  'The result gives the card id; pass it to `routine.schedule` as `alert_card` ' +
  "when the card's alert drives a routine. " +
  cardGuide({ interactive: true });

export const POST_BLOCKS_TOOL_DEF: ChatToolDefinition = {
  type: 'function',
  function: {
    name: POST_BLOCKS_TOOL,
    description: POST_BLOCKS_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description: 'The plain summary shown in previews and notifications.',
        },
        title: { type: 'string', maxLength: 120 },
        icon: { type: 'string', enum: [...BlockIconSchema.literals] },
        meta: { type: 'string', maxLength: 40 },
        blocks: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { type: 'object' },
        },
      },
      required: ['text', 'blocks'],
      additionalProperties: false,
    },
  },
};
