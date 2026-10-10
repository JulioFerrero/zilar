// Chat preferences (T-0113, T-0458): the caller's per-chat mute, archive, pin
// and background rows, plus the per-user default background. A write that
// lands back on the all-defaults row answers `{ prefs: null }`; otherwise the
// bare pref view.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { IsoDateTime } from './iso-datetime';
import { SchemaErrors, Session } from './middleware';

// Mirrors `CHAT_BACKGROUND_PRESET_IDS` in `packages/ui-tokens` (T-0457). The
// contract keeps its own copy so it does not depend on the UI package.
export const CHAT_BACKGROUND_PRESET_IDS = [
  'slate',
  'gold',
  'blue',
  'navy',
  'forest',
  'wine',
  'amber',
] as const;

export const BackgroundPreset = Schema.Literals(CHAT_BACKGROUND_PRESET_IDS);

export type BackgroundPreset = typeof BackgroundPreset.Type;

// The three nullable background columns, returned for both the per-chat pref
// and the per-user default. The response keeps `string` for the preset so it
// accepts every persisted value.
export const ChatBackgroundChoice = Schema.Struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

export type ChatBackgroundChoice = typeof ChatBackgroundChoice.Type;

/** The background fields are optional so an older server's rows still decode. */
export const ChatPref = Schema.Struct({
  chatJid: Schema.String,
  mutedUntil: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  pinnedAt: Schema.NullOr(Schema.String),
  backgroundPreset: Schema.optional(Schema.NullOr(Schema.String)),
  backgroundImageId: Schema.optional(Schema.NullOr(Schema.String)),
  backgroundDim: Schema.optional(Schema.NullOr(Schema.Number)),
  updatedAt: Schema.String,
});

export type ChatPref = typeof ChatPref.Type;

/** The server always sends `defaultBackground`; the clients that read only `prefs` need not. */
export const ChatPrefList = Schema.Struct({
  prefs: Schema.Array(ChatPref),
  defaultBackground: Schema.optional(ChatBackgroundChoice),
});

export const PutChatPrefResult = Schema.Union([ChatPref, Schema.Struct({ prefs: Schema.Null })]);

export const ChatBackgroundDefault = Schema.Struct({ defaultBackground: ChatBackgroundChoice });

// A preset id, or an owned image id plus an optional dim; null clears a field.
// Unknown keys are rejected through the strict payload decode.
const backgroundFieldsShape = {
  backgroundPreset: Schema.optional(Schema.NullOr(BackgroundPreset)),
  backgroundImageId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  ),
  backgroundDim: Schema.optional(
    Schema.NullOr(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(80),
      ),
    ),
  ),
};

/**
 * `mutedUntil`: an ISO datetime string (a far-future value means "forever"),
 * or null to unmute. `pinned`: true stamps now, false clears the pin.
 */
export const PutChatPrefPayload = Schema.Struct({
  mutedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  archived: Schema.optional(Schema.Boolean),
  pinned: Schema.optional(Schema.Boolean),
  ...backgroundFieldsShape,
}).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

export const PutChatBackgroundPayload = Schema.Struct(backgroundFieldsShape).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

export const ChatPrefsGroup = HttpApiGroup.make('chatPrefs')
  .add(
    HttpApiEndpoint.get('list', '/chat-prefs', {
      success: ChatPrefList,
    }),
    HttpApiEndpoint.put('putPref', '/chat-prefs/:chatJid', {
      params: { chatJid: Schema.String },
      payload: PutChatPrefPayload,
      success: PutChatPrefResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('getBackground', '/chat-background', {
      success: ChatBackgroundDefault,
    }),
    HttpApiEndpoint.put('putBackground', '/chat-background', {
      payload: PutChatBackgroundPayload,
      success: ChatBackgroundDefault,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
