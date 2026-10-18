import { cardGuide } from '../../message-blocks/guide';
import { toolDefinition } from './definitions';
import { POST_BLOCKS_TOOL, PostBlocksArgsSchema } from './schemas';
import { toolParameters } from './tool-params';

export const POST_BLOCKS_TOOL_DEF = toolDefinition(
  POST_BLOCKS_TOOL,
  'Post a small native card with numbers, lists or status — not for prose. `text` ' +
    'is the plain summary people see in previews and notifications; every other ' +
    'value is a pre-formatted display string and links must be https. ' +
    'The result gives the card id; pass it to `routine.schedule` as `alert_card` ' +
    "when the card's alert drives a routine. " +
    cardGuide({ interactive: true }),
  toolParameters(PostBlocksArgsSchema),
);
