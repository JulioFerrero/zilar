import { BlockIconSchema } from '@zilar/protocol';
import type { ChatToolDefinition } from './definitions';
import { POST_BLOCKS_TOOL } from './schemas';

// T-1758: the `post_blocks` tool definition. The model posts one small native
// card in a group room. Clients render the six Wave 1 kinds, so the tool offers
// only those; the server checks the real block shapes again in
// `buildBlocksPayload`, and a bad card comes back as `invalid: <reason>`.
const POST_BLOCKS_DESCRIPTION =
  'Post a small native card with numbers, lists or status — not for prose. `text` ' +
  'is the plain summary people see in previews and notifications. Each block is an ' +
  'object with a `kind` field, for example ' +
  '{"kind":"figure","rows":[{"label":"BTC","value":"$82,302","change":{"direction":"up","text":"2.1%"}}]}. ' +
  'Values are pre-formatted strings like "$82,302"; links must be https. Six kinds: ' +
  'kind=figure {rows:[{label,value,change?:{direction:up|down|flat,text}}]}; ' +
  'kind=number {label,value,change?,points?:number[]}; ' +
  'kind=checklist {id,title,items:[{id,label,done}]}; ' +
  'kind=status {title,rows:[{label,status:ok|warn|bad,value?}]}; ' +
  'kind=link {url,title,description?}; ' +
  'kind=callout {tone:success|warning|error|info,text}.';

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
