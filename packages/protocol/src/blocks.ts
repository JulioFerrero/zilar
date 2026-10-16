import { Schema } from 'effect';
import { struct } from './common';
import {
  BarsBlockSchema,
  BlockIconSchema,
  FigureBlockSchema,
  GaugeBlockSchema,
  LineBlockSchema,
  MAX_BLOCKS,
  MAX_BLOCK_BYTES,
  NumberBlockSchema,
  ShortText,
  StatsBlockSchema,
  TableBlockSchema,
  Text,
} from './blocks-numbers';
import {
  AlertBlockSchema,
  ButtonsBlockSchema,
  ChoiceBlockSchema,
  FormBlockSchema,
  PollBlockSchema,
  RatingBlockSchema,
} from './blocks-choices';
import {
  CalloutBlockSchema,
  EventBlockSchema,
  FileBlockSchema,
  ImagesBlockSchema,
  LinkBlockSchema,
  PlaceBlockSchema,
  WeatherBlockSchema,
} from './blocks-content';
import {
  ChecklistBlockSchema,
  CountdownBlockSchema,
  ProgressBlockSchema,
  StatusBlockSchema,
  TimelineBlockSchema,
} from './blocks-progress';

// The shared helpers and caps live in `blocks-numbers.ts`, the first group; this
// file aggregates the four groups so nothing has to import back into it.
export * from './blocks-numbers';
export * from './blocks-progress';
export * from './blocks-choices';
export * from './blocks-content';

// The union of every kind, in board order 01-25.
export const BlockSchema = Schema.Union([
  FigureBlockSchema,
  NumberBlockSchema,
  StatsBlockSchema,
  TableBlockSchema,
  BarsBlockSchema,
  LineBlockSchema,
  GaugeBlockSchema,
  ChecklistBlockSchema,
  ProgressBlockSchema,
  TimelineBlockSchema,
  CountdownBlockSchema,
  StatusBlockSchema,
  ButtonsBlockSchema,
  PollBlockSchema,
  ChoiceBlockSchema,
  FormBlockSchema,
  RatingBlockSchema,
  AlertBlockSchema,
  LinkBlockSchema,
  ImagesBlockSchema,
  PlaceBlockSchema,
  WeatherBlockSchema,
  EventBlockSchema,
  FileBlockSchema,
  CalloutBlockSchema,
]);

export type Block = typeof BlockSchema.Type;

export const BlocksDataSchema = struct({
  title: Schema.optional(Text),
  icon: Schema.optional(BlockIconSchema),
  meta: Schema.optional(ShortText),
  // Required and plain: push, previews, the chat list, search, the memory
  // indexer and old clients all read the message body, never the blocks.
  fallback: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  blocks: Schema.mutable(Schema.Array(BlockSchema)).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_BLOCKS),
      Schema.makeFilter((blocks) =>
        JSON.stringify(blocks).length > MAX_BLOCK_BYTES
          ? 'blocks exceed the 16 KiB limit'
          : undefined,
      ),
    ),
  ),
});

export type BlocksData = typeof BlocksDataSchema.Type;
