// Interactive message cards (T-1792, Wave 2 B9): a room member answers the
// card an AI posted — a checklist tick, a poll vote, a choice, a rating, a
// button or a quick form. The server records the answer, merges it into the
// card and corrects the card as the AI, so everyone in the room sees the new
// state. The route never wakes the AI; for the decision kinds the client also
// sends the normal `@AI` reply.
//
// The drawn card is a `BlocksData` from `@zilar/protocol`. The contract package
// depends on `effect` only, so the shape stays opaque here and a client decodes
// it again with `BlocksDataSchema`.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { BlocksRespondRateLimit, SchemaErrors, Session } from './middleware';

export const BLOCKS_RESPOND_ID_MAX = 256;
export const BLOCKS_RESPOND_FORM_VALUE_MAX = 120;

const IdText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(BLOCKS_RESPOND_ID_MAX),
);

/**
 * One answer. The block's kind decides which fields it reads: `done` for a
 * checklist, `optionIds` for a poll, `selected` for a choice, `rating` for a
 * rating, `actionId` for a button and `fields` for a form.
 */
export const BlocksRespondValue = Schema.Struct({
  done: Schema.optional(Schema.Boolean),
  optionIds: Schema.optional(Schema.mutable(Schema.Array(IdText))),
  selected: Schema.optional(Schema.Int),
  rating: Schema.optional(Schema.Int),
  actionId: Schema.optional(IdText),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type BlocksRespondValue = typeof BlocksRespondValue.Type;

/**
 * A tap on a card. `messageId` is the id the client knows — the stanza id the
 * card came back as, or the origin id while that is all it has.
 */
export const BlocksRespondPayload = Schema.Struct({
  messageId: IdText,
  blockId: IdText,
  itemId: Schema.optional(IdText),
  value: BlocksRespondValue,
});

export type BlocksRespondPayload = typeof BlocksRespondPayload.Type;

/** The merged card; `data` is a `BlocksData`, opaque to this package. */
export const BlocksRespondResult = Schema.Struct({ data: Schema.Unknown });

export type BlocksRespondResult = typeof BlocksRespondResult.Type;

/** The card whose own poll picks the viewer asks for. */
export const BlocksMyPicksQuery = Schema.Struct({ messageId: IdText });

export type BlocksMyPicksQuery = typeof BlocksMyPicksQuery.Type;

/** The viewer's picks, keyed by the poll block they belong to. */
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
