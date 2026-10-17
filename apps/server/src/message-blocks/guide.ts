import { BlockIconSchema, MAX_ROWS, MAX_SHORT, MAX_TEXT, type Block } from '@zilar/protocol';

// T-1768: one general card guide shared by the `post_blocks` tool description
// and the tool guide (which every AI turn with tools carries). Before this, the
// AI learned cards from one prices-shaped paragraph in `post_blocks` and a
// single line for saved tools, so any other kind of data had no guidance.
//
// `CARD_KINDS` is the set the web and mobile apps can draw today. The protocol
// (`packages/protocol/src/blocks.ts`) validates more kinds than that; a tool
// whose card uses an undrawn kind is told so, never silently downgraded.

export const CARD_KINDS: readonly Block['kind'][] = [
  'figure',
  'number',
  'stats',
  'table',
  'bars',
  'line',
  'gauge',
  'checklist',
  'progress',
  'timeline',
  'countdown',
  'status',
  'link',
  'place',
  'weather',
  'event',
  'callout',
];

// The general rules, kept short: a header, how to choose a kind, how to write
// values, and where the time and source live. The shape map is written out as a
// markdown table so the model matches the data it has to the kind that fits.
//
// The valid icons are read from the protocol literal so the guide can never
// drift from `BlockIconSchema`; any other name fails the whole card decode.
const CARD_ICONS = BlockIconSchema.literals.join('|');
export const CARD_RULES = [
  'A card is a header plus 1-6 blocks.',
  `Always set \`title\` (2-4 words naming the subject, never a tool name), an \`icon\` (one of: ${CARD_ICONS}) and \`meta\` (a short time, date, schedule or source, for example \`daily 09:00\`, \`Fri 17 Oct\`, \`Live\`).`,
  'Choose the kind by the shape of the data:',
  '| The data | The kind |',
  '|---|---|',
  '| a few labelled values | `figure` |',
  '| one headline value (with a trend) | `number` (with `points`) |',
  '| 2-6 key figures as tiles | `stats` |',
  '| rows × columns | `table` |',
  '| amounts or counts compared across categories | `bars` (it starts from 0) |',
  '| a value over time: a price, rate, temperature or score | `line` with `points` |',
  '| a share of a limit | `gauge`, or `progress` for a task |',
  '| ordered steps | `timeline` |',
  '| a deadline | `countdown` |',
  '| the health of several things | `status` |',
  '| to-dos | `checklist` |',
  '| a forecast | `weather` |',
  '| a meeting | `event` |',
  '| a location | `place` (no map) |',
  '| a web page | `link` |',
  '| one notice | `callout` |',
  'Never use bars for a trend of close values; use `line`.',
  'Every value is a final display string (`$82,302`, `18°`, `2.1%`, `Fri 17 Oct`), never a raw number or ISO 8601 date-time, except the fields that are numbers by contract (`points`, `series[].value`, `ratio`, and `min`/`max` on a line).',
  `Lengths: \`title\` up to ${MAX_TEXT} characters; \`meta\`, values and other short labels up to ${MAX_SHORT}; at most ${MAX_ROWS} rows in a list or table.`,
  'A `datetime` below is ISO 8601 with seconds and offset, e.g. `2026-10-17T09:00:00+02:00`; the seconds and the offset are required (a plain `YYYY-MM-DD` or a missing offset fails the card).',
  'List `id` fields (checklist `id` and `items[].id`) use letters, digits and `.` `_` `~` `-` only, no spaces, e.g. `milk`, `step-2`.',
  'A change is `change: { direction: up|down|flat, text }` with the absolute value, and the arrow comes from `direction`.',
  'The time and source go in `meta`, never in a callout; a callout is only for a warning or a note the reader must act on.',
  '`text` is a one-line plain summary for notifications.',
].join('\n');

// The exact fields of every kind, read from `packages/protocol/src/blocks-*.ts`,
// one compact line per kind in `CARD_KINDS`. Optionals are marked `?`.
export const CARD_SHAPES = [
  'kind=figure {rows:[{label,value,change?:{direction:up|down|flat,text}}]}',
  'kind=number {label,value,code?,change?:{direction:up|down|flat,text},points?:number[]}',
  'kind=stats {title?,tiles:[{label,value,ratio?:0..1}]}',
  'kind=table {title?,columns:string[],rows:string[][],total?:boolean}',
  'kind=bars {title?,value?,series:[{label,value:number,current?:boolean}]}',
  'kind=line {title?,value?,points:number[],min?:number,max?:number,labels?:string[]}',
  'kind=gauge {label,ratio:0..1,value,caption?,detail?}',
  'kind=checklist {id,title,items:[{id,label,done:boolean,by?}]}',
  'kind=progress {label,ratio:0..1,detail?,note?}',
  'kind=timeline {title,steps:[{label,at?,detail?,state:done|current|todo}]}',
  'kind=countdown {label,targetAt:datetime,note?}',
  'kind=status {title,rows:[{label,status:ok|warn|bad,value?}]}',
  'kind=link {url:https,site?,title,description?}',
  'kind=place {title,subtitle?,url?}',
  'kind=weather {place,condition,high,low,temp,hourly?:[{at,condition,temp}]}',
  'kind=event {title,startAt:datetime,endAt:datetime,detail?}',
  'kind=callout {tone:success|warning|error|info,text}',
].join('\n');

export function cardGuide(): string {
  return CARD_RULES + '\n' + CARD_SHAPES;
}
