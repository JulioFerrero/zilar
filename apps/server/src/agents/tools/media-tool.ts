import { toolDefinition } from './definitions';
import {
  FETCH_MEDIA_TOOL,
  FetchMediaArgsSchema,
  SAVE_TEXT_MEDIA_TOOL,
  SaveTextMediaArgsSchema,
} from './schemas';
import { toolParameters } from './tool-params';

export const FETCH_MEDIA_TOOL_DEF = toolDefinition(
  FETCH_MEDIA_TOOL,
  'Fetch one https image (PNG, JPEG, WebP; at most 8 MB) or file (PDF, CSV, ' +
    'plain text; at most 25 MB) so a card can show it. Returns a media id: put ' +
    'the id in an `images` block (`items`) or a `file` block (`media`), never ' +
    'the URL.',
  toolParameters(FetchMediaArgsSchema),
);

export const SAVE_TEXT_MEDIA_TOOL_DEF = toolDefinition(
  SAVE_TEXT_MEDIA_TOOL,
  'Save text you wrote (CSV, plain text, Markdown or JSON; at most 64 KB) as a ' +
    'file people can download from a card. Returns a media id: put it in a ' +
    "`file` block's `media`.",
  toolParameters(SaveTextMediaArgsSchema),
);
