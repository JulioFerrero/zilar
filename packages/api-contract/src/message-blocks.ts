// The route never wakes the AI; for the decision kinds the client also sends the normal `@AI` reply.
// `data` is a `BlocksData` from `@zilar/protocol`; this package depends on `effect` only, so it stays opaque and a client decodes it again.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { BlocksRespondRateLimit, SchemaErrors, Session } from './middleware';

export const BLOCKS_RESPOND_ID_MAX = 256;

const IdText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(BLOCKS_RESPOND_ID_MAX),
);

// The block's kind decides which fields an answer reads: `done`, `optionIds`, `selected`, `rating`, `actionId` or `fields`.
export const BlocksRespondValue = Schema.Struct({
  done: Schema.optional(Schema.Boolean),
  optionIds: Schema.optional(Schema.mutable(Schema.Array(IdText))),
  selected: Schema.optional(Schema.Int),
  rating: Schema.optional(Schema.Int),
  actionId: Schema.optional(IdText),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type BlocksRespondValue = typeof BlocksRespondValue.Type;

// `messageId` is the stanza id the card came back as, or the origin id while that is all the client has.
export const BlocksRespondPayload = Schema.Struct({
  messageId: IdText,
  blockId: IdText,
  itemId: Schema.optional(IdText),
  value: BlocksRespondValue,
});

export type BlocksRespondPayload = typeof BlocksRespondPayload.Type;

export const BlocksRespondResult = Schema.Struct({ data: Schema.Unknown });

export type BlocksRespondResult = typeof BlocksRespondResult.Type;

export const BlocksMyPicksQuery = Schema.Struct({ messageId: IdText });

export type BlocksMyPicksQuery = typeof BlocksMyPicksQuery.Type;

export const BlocksMyPicksResult = Schema.Struct({
  picks: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

export type BlocksMyPicksResult = typeof BlocksMyPicksResult.Type;

export const MessageBlocksGroup = HttpApiGroup.make('message-blocks')
  .add(
    HttpApiEndpoint.post('respond', '/blocks/respond', {
      payload: BlocksRespondPayload,
      success: BlocksRespondResult,
    }).middleware(BlocksRespondRateLimit),
    HttpApiEndpoint.get('mine', '/blocks/mine', {
      query: BlocksMyPicksQuery,
      success: BlocksMyPicksResult,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
