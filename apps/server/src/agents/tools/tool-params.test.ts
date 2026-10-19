import { describe, expect, it } from 'vitest';
import {
  ASK_PEOPLE_TOOL_DEF,
  FETCH_MEDIA_TOOL_DEF,
  POST_BLOCKS_TOOL_DEF,
  SAVE_TEXT_MEDIA_TOOL_DEF,
} from './definitions';

const TOOLS = [
  ASK_PEOPLE_TOOL_DEF,
  POST_BLOCKS_TOOL_DEF,
  FETCH_MEDIA_TOOL_DEF,
  SAVE_TEXT_MEDIA_TOOL_DEF,
];

const EXPECTED: Record<string, unknown> = {
  ask_people: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        minLength: 1,
        maxLength: 140,
      },
      options: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 24,
        },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
  post_blocks: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
        description: 'The plain summary shown in previews and notifications.',
      },
      title: {
        type: 'string',
        maxLength: 120,
      },
      icon: {
        type: 'string',
        enum: [
          'activity',
          'bell',
          'calendar',
          'chart',
          'check',
          'clock',
          'cloud-sun',
          'file',
          'gauge',
          'images',
          'info',
          'link',
          'list-checks',
          'loader',
          'map-pin',
          'mouse-pointer-click',
          'route',
          'sliders',
          'star',
          'table',
          'timer',
          'trending-up',
          'vote',
          'warning',
        ],
      },
      meta: {
        type: 'string',
        maxLength: 40,
      },
      blocks: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
        },
      },
    },
    required: ['text', 'blocks'],
    additionalProperties: false,
  },
  fetch_media: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        description: 'An https URL.',
      },
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
  save_text_media: {
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
        enum: ['csv', 'txt', 'md', 'json'],
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
};

describe('tool parameters sent to the model', () => {
  for (const tool of TOOLS) {
    it(`${tool.function.name} sends the same JSON schema`, () => {
      expect(tool.function.parameters).toEqual(EXPECTED[tool.function.name]);
    });
  }
});
