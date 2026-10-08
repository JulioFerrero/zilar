/**
 * The screenshot shot table (T-0131, T-0133): every shot as plain data,
 * validated with Effect Schema before the browser even starts.
 *
 * This module has no side effects so tests can import it: importing
 * `screenshots.ts` would launch the capture run (`await main()`).
 *
 * It also has no imports at all (the Effect `Schema` module is injected by
 * the caller): the file is typechecked both by `scripts/tsconfig.json`
 * (node types, effect path mapping) and as part of `@zilar/web` (via the
 * `shots.test.ts` import, whose module resolution cannot see `effect` from
 * here), so it must not rely on either.
 */
export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };

/**
 * Every setup `runSetup` in `screenshots.ts` implements. The schema built
 * by {@link parseShots} fails a typo in the shot table before the browser
 * even starts.
 */
export const SHOT_SETUPS = [
  'none',
  'searchTickets',
  'openChatMenu',
  'openNewTopic',
  'openToolDetail',
  'openRoutines',
] as const;

/**
 * The slice of the Effect `Schema` module the shot table needs, typed
 * structurally (methods, so the real module satisfies it) with no reference
 * to `effect` at all: `@zilar/web` resolves bare specifiers from its own
 * `node_modules`, so a `typeof import('effect')` here would not compile
 * there.
 */
export interface SchemaModule {
  readonly String: unknown;
  readonly Number: unknown;
  Struct(fields: unknown): unknown;
  Literals(values: unknown): unknown;
  Array(schema: unknown): unknown;
  mutable(schema: unknown): unknown;
  decodeUnknownSync(schema: unknown): (value: unknown) => unknown;
}

export interface Shot {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  setup: string;
}

export interface ShotDef {
  /** File name under `docs/screenshots/`. */
  name: string;
  /** Path after the base URL (mock query appended automatically). */
  path: string;
  viewport: { width: number; height: number };
  /**
   * Named setup, implemented in `runSetup`. Keeps the shot table
   * serializable so it can be validated with Effect Schema; the literal
   * union on the schema fails a typo here before the browser even starts.
   */
  setup: string;
}

export const DESKTOP_SHOTS: ShotDef[] = [
  { name: 'signin-desktop.png', path: '/login', viewport: DESKTOP, setup: 'none' },
  { name: 'topics-desktop.png', path: '/', viewport: DESKTOP, setup: 'none' },
  { name: 'topic-desktop.png', path: '/c/c-devteam-bug', viewport: DESKTOP, setup: 'none' },
  { name: 'group-desktop.png', path: '/c/c-qa?panel=group', viewport: DESKTOP, setup: 'none' },
  {
    name: 'approval-desktop.png',
    path: '/settings/approvals',
    viewport: DESKTOP,
    setup: 'none',
  },
  { name: 'search-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'searchTickets' },
  { name: 'pins-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'none' },
  { name: 'prefs-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'openChatMenu' },
  { name: 'newtopic-desktop.png', path: '/', viewport: DESKTOP, setup: 'openNewTopic' },
  {
    name: 'aisettings-desktop.png',
    path: '/c/c-devai?panel=ai',
    viewport: DESKTOP,
    setup: 'none',
  },
  { name: 'machines-desktop.png', path: '/settings/machines', viewport: DESKTOP, setup: 'none' },
  // T-0107: the tools and routines of the Dev team bug topic (mock mode
  // seeds two tools and two routines), open on the tool detail.
  {
    name: 'tools-desktop.png',
    path: '/c/c-devteam-bug?panel=topic',
    viewport: DESKTOP,
    setup: 'openToolDetail',
  },
  {
    name: 'routines-desktop.png',
    path: '/c/c-devteam-bug?panel=topic',
    viewport: DESKTOP,
    setup: 'openRoutines',
  },
];

export const PHONE_SHOTS: ShotDef[] = [
  { name: 'topics-phone.png', path: '/', viewport: PHONE, setup: 'none' },
  { name: 'topic-phone.png', path: '/c/c-devteam-bug', viewport: PHONE, setup: 'none' },
  { name: 'chat-phone.png', path: '/c/c-ana', viewport: PHONE, setup: 'none' },
  // The search box lives in the list pane, which a phone hides while a chat
  // is open — so the phone search shot starts from the list.
  { name: 'search-phone.png', path: '/', viewport: PHONE, setup: 'searchTickets' },
];

/**
 * Validates shot rows: `setup` is a literal union, so a typo fails here
 * before the browser starts.
 */
export function parseShots(schema: SchemaModule, shots: ShotDef[]): Shot[] {
  const shot = schema.Struct({
    name: schema.String,
    path: schema.String,
    viewport: schema.Struct({ width: schema.Number, height: schema.Number }),
    setup: schema.Literals(SHOT_SETUPS),
  });
  return schema.decodeUnknownSync(schema.mutable(schema.Array(shot)))(shots) as Shot[];
}

/** Every shot as plain data, validated before the browser even starts. */
export function shotTable(schema: SchemaModule): Shot[] {
  return parseShots(schema, [...DESKTOP_SHOTS, ...PHONE_SHOTS]);
}
