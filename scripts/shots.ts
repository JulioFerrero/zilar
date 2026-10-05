/**
 * The screenshot shot table (T-0131, T-0133): every shot as plain data,
 * validated with zod before the browser even starts.
 *
 * This module has no side effects so tests can import it: importing
 * `screenshots.ts` would launch the capture run (`await main()`).
 *
 * It also has no imports at all (zod is injected by the caller): the file
 * is typechecked both by `scripts/tsconfig.json` (node types, zod path
 * mapping) and as part of `@zilar/web` (via the `shots.test.ts` import,
 * whose tsconfig has neither), so it must not rely on either.
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
 * The zod subset the shot table needs, typed structurally (methods, so
 * both the real zod module and `z` satisfy it under either tsconfig).
 */
export interface ZodLib {
  enum(values: readonly [string, ...string[]]): {
    array(): { parse(value: unknown): unknown };
  };
  object(shape: Record<string, unknown>): {
    array(): { parse(value: unknown): unknown };
  };
  string(): unknown;
  number(): unknown;
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
   * serializable so it can be validated with zod; the enum on the schema
   * fails a typo here before the browser even starts.
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

/** Validates shot rows: `setup` is an enum, so a typo fails here. */
export function parseShots(zod: ZodLib, shots: ShotDef[]): Shot[] {
  const schema = zod.object({
    name: zod.string(),
    path: zod.string(),
    viewport: zod.object({ width: zod.number(), height: zod.number() }),
    setup: zod.enum(SHOT_SETUPS),
  });
  return schema.array().parse(shots) as Shot[];
}

/** Every shot as plain data, validated before the browser even starts. */
export function shotTable(zod: ZodLib): Shot[] {
  return parseShots(zod, [...DESKTOP_SHOTS, ...PHONE_SHOTS]);
}
