import type { ChatToolDefinition } from './definitions';
import { FETCH_MEDIA_TOOL } from './schemas';

// T-1873: the `fetch_media` tool definition. The model fetches one https image
// or file; the server sniffs the real type, stores the bytes and returns the
// media id the model puts in an `images` or `file` block.
const FETCH_MEDIA_DESCRIPTION =
  'Fetch one https image (PNG, JPEG, WebP; at most 8 MB) or file (PDF, CSV, ' +
  'plain text; at most 25 MB) so a card can show it. Returns a media id: put ' +
  'the id in an `images` block (`items`) or a `file` block (`media`), never ' +
  'the URL.';

export const FETCH_MEDIA_TOOL_DEF: ChatToolDefinition = {
  type: 'function',
  function: {
    name: FETCH_MEDIA_TOOL,
    description: FETCH_MEDIA_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2048, description: 'An https URL.' },
        kind: {
          type: 'string',
          enum: ['image', 'file'],
          description: 'Image media render inline; file media get a download card.',
        },
        name: {
          type: 'string',
          maxLength: 100,
          description: 'The display name people see; defaults to the URL name.',
        },
      },
      required: ['url', 'kind'],
      additionalProperties: false,
    },
  },
};
