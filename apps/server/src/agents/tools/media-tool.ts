import type { ChatToolDefinition } from './definitions';
import { FETCH_MEDIA_TOOL, SAVE_TEXT_MEDIA_FORMATS, SAVE_TEXT_MEDIA_TOOL } from './schemas';

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

const SAVE_TEXT_MEDIA_DESCRIPTION =
  'Save text you wrote (CSV, plain text, Markdown or JSON; at most 64 KB) as a ' +
  'file people can download from a card. Returns a media id: put it in a ' +
  "`file` block's `media`.";

export const SAVE_TEXT_MEDIA_TOOL_DEF: ChatToolDefinition = {
  type: 'function',
  function: {
    name: SAVE_TEXT_MEDIA_TOOL,
    description: SAVE_TEXT_MEDIA_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'The display name; the format extension is added when it is missing.',
        },
        format: {
          type: 'string',
          enum: [...SAVE_TEXT_MEDIA_FORMATS],
          description: 'The file type: csv, txt, md or json.',
        },
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 65536,
          description: 'The text to save, unchanged.',
        },
      },
      required: ['name', 'format', 'content'],
      additionalProperties: false,
    },
  },
};
