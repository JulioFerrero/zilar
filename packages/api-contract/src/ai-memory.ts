// The AI-memory routes (T-0443): the pinned facts and cover lines of one
// chat. `chat` is the DM peer's bare JID (the AI's JID in a DM) or a room
// JID; `ai` is the AI's id. `canChange` is false for a room member who may
// only view.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { AiMemoryWriteRateLimit, SchemaErrors, Session } from './middleware';

// 1..256 characters; the query and payload decodes are strict, so an excess
// key is a 400.
const ChatField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const AiMemoryQuery = Schema.Struct({ chat: ChatField, ai: ChatField });

export const ClearAiMemoryPayload = Schema.Struct({ chat: ChatField, ai: ChatField });

export const AiMemoryFact = Schema.Struct({ id: Schema.String, text: Schema.String });

export type AiMemoryFact = typeof AiMemoryFact.Type;

export const AiMemoryView = Schema.Struct({
  facts: Schema.Array(AiMemoryFact),
  lines: Schema.Array(Schema.String),
  canChange: Schema.Boolean,
});

export type AiMemoryView = typeof AiMemoryView.Type;

export const AiMemoryOk = Schema.Struct({ ok: Schema.Literal(true) });

export const AiMemoryGroup = HttpApiGroup.make('aiMemory')
  .add(
    HttpApiEndpoint.get('view', '/ai-memory', {
      query: AiMemoryQuery,
      success: AiMemoryView,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('deleteFact', '/ai-memory/facts/:id', {
      params: { id: Schema.String },
      query: AiMemoryQuery,
      success: AiMemoryOk,
    })
      .annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' })
      .middleware(AiMemoryWriteRateLimit),
    HttpApiEndpoint.post('clear', '/ai-memory/clear', {
      payload: ClearAiMemoryPayload,
      success: AiMemoryOk,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AiMemoryWriteRateLimit),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
