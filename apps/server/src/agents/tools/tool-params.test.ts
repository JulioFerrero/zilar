import { describe, expect, it } from 'vitest';
import {
  ASK_PEOPLE_TOOL_DEF,
  MEMORY_TOOLS,
  PERSONA_TOOLS,
  TASK_STATUS_TOOL_DEF,
  buildDelegateTool,
  buildRequestActionTool,
} from './definitions';
import { FETCH_MEDIA_TOOL_DEF, SAVE_TEXT_MEDIA_TOOL_DEF } from './definitions';
import { POST_BLOCKS_TOOL_DEF } from './definitions';
import { deskToolDefinitions } from './definitions';

const TOOLS = [
  ...PERSONA_TOOLS,
  ...MEMORY_TOOLS,
  buildRequestActionTool([
    { name: 'weather.check', description: 'Check the weather', argsExample: '{"city":"Berlin"}' },
  ]),
  buildDelegateTool([{ id: 'ai-1', name: 'Helper' }]),
  ASK_PEOPLE_TOOL_DEF,
  TASK_STATUS_TOOL_DEF,
  POST_BLOCKS_TOOL_DEF,
  FETCH_MEDIA_TOOL_DEF,
  SAVE_TEXT_MEDIA_TOOL_DEF,
  ...deskToolDefinitions(),
];

const EXPECTED: Record<string, unknown> = {
  update_persona: {
    type: 'object',
    properties: {
      persona: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
      },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
    },
    required: ['persona', 'summary'],
    additionalProperties: false,
  },
  revert_persona: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  recall: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  memory_zoom: {
    type: 'object',
    properties: {
      block: {
        type: 'string',
        pattern: '^\\d{1,9}-\\d{1,9}$',
      },
    },
    required: ['block'],
    additionalProperties: false,
  },
  remember: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: 280,
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
  request_action: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
      args: {
        type: 'object',
        additionalProperties: true,
      },
    },
    required: ['action', 'args'],
    additionalProperties: false,
  },
  delegate: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
      },
      objective: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
      },
      context_summary: {
        type: 'string',
        maxLength: 1200,
      },
      acceptance: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 300,
        },
        maxItems: 10,
      },
      return_format: {
        type: 'string',
        maxLength: 200,
      },
    },
    required: ['to', 'objective'],
    additionalProperties: false,
  },
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
  task_status: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
      },
    },
    required: ['task_id'],
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
  bash: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        minLength: 1,
        maxLength: 8000,
      },
      cwd: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        maximum: 600000,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  read: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      offset: {
        type: 'integer',
        minimum: 1,
      },
      limit: {
        type: 'integer',
        minimum: 1,
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  write: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      content: {
        type: 'string',
        maxLength: 1000000,
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  edit: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      oldString: {
        type: 'string',
        minLength: 1,
        maxLength: 1000000,
      },
      newString: {
        type: 'string',
        maxLength: 1000000,
      },
      replaceAll: {
        type: 'boolean',
      },
    },
    required: ['path', 'oldString', 'newString'],
    additionalProperties: false,
  },
  grep: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
      },
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      glob: {
        type: 'string',
        minLength: 1,
        maxLength: 512,
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  glob: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  git: {
    type: 'object',
    properties: {
      args: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
        },
        maxItems: 64,
      },
    },
    required: ['args'],
    additionalProperties: false,
  },
};

describe('tool parameters sent to the model', () => {
  it('lists each tool once', () => {
    const names = TOOLS.map((tool) => tool.function.name);
    expect(names).toHaveLength(new Set(names).size);
    expect(Object.keys(EXPECTED).sort()).toEqual([...names].sort());
    expect(names).toHaveLength(19);
  });

  for (const tool of TOOLS) {
    it(`${tool.function.name} sends the same JSON schema`, () => {
      expect(tool.function.parameters).toEqual(EXPECTED[tool.function.name]);
    });
  }
});
