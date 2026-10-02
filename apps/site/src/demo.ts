// Pure state for the feature instruments: schedules, fingerprints, countdowns and tool versions.
// The DOM side lives in instruments.ts.

export const SCHEDULES = {
  hourly: {
    flap: 'EVERY HOUR',
    note: 'Gold, the S&P 500 and BTC, every hour. Hourly is the shortest interval.',
  },
  daily: {
    flap: 'DAILY 09:00',
    note: 'Gold, the S&P 500 and BTC, posted every morning at 09:00.',
  },
  weekdays: {
    flap: 'MON-FRI 09:00',
    note: 'Gold, the S&P 500 and BTC, at 09:00 on weekdays only.',
  },
} as const;

export type ScheduleId = keyof typeof SCHEDULES;

export const FLAP_WIDTH = 13;
export const FLAP_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-';

export function isScheduleId(value: string | undefined): value is ScheduleId {
  return value !== undefined && value in SCHEDULES;
}

// A split-flap row always has the same number of cells: shorter text is padded with blanks.
export function flapText(text: string, width: number = FLAP_WIDTH): string {
  return text.toUpperCase().slice(0, width).padEnd(width, ' ');
}

export function countdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${String(minutes).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

const HEX = '0123456789abcdef';

export function hexId(random: () => number, length: number): string {
  return Array.from({ length }, () => HEX[Math.floor(random() * 16)] ?? '0').join('');
}

export function groupHex(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? '';
}

// One frame of a readout settling on its value: the first `revealed` characters are final,
// the rest still flicker. Spaces stay put so the groups never jump.
export function settle(target: string, revealed: number, random: () => number): string {
  return [...target]
    .map((char, index) => (index < revealed || char === ' ' ? char : hexId(random, 1)))
    .join('');
}

export type Version = { n: number; title: string; code: readonly string[] };

export const MAX_VERSIONS = 6;

export const TOOL_VERSIONS: readonly Version[] = [
  {
    n: 1,
    title: 'First version',
    code: ['export function run() {', "  return fetchPrices(['gold']);", '}'],
  },
  {
    n: 2,
    title: 'Add the S&P 500 and BTC',
    code: ['export function run() {', "  return fetchPrices(['gold', 'spx', 'btc']);", '}'],
  },
  {
    n: 3,
    title: 'Post a short table',
    code: [
      'export async function run() {',
      "  const prices = await fetchPrices(['gold', 'spx', 'btc']);",
      '  return table(prices);',
      '}',
    ],
  },
];

// Reverting never rewrites history: it appends a new version with the old code.
export function revertTo(versions: readonly Version[], n: number): readonly Version[] {
  const source = versions.find((version) => version.n === n);
  const last = versions.at(-1);
  if (!source || !last || source === last || versions.length >= MAX_VERSIONS) return versions;
  return [...versions, { n: last.n + 1, title: `Revert to v${n}`, code: source.code }];
}

// Which lines of a version are new compared with the version before it.
export function changedLines(previous: readonly string[] | undefined, code: readonly string[]) {
  return code.map((line) => previous !== undefined && !previous.includes(line));
}

// Detents of the provider selector, left to right: the providers Zilar connects to.
export const PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Gemini',
  'DeepSeek',
  'xAI',
  'OpenRouter',
] as const;
export const PROVIDER_SWEEP = 150;

export function providerAngle(index: number): number {
  const step = PROVIDER_SWEEP / (PROVIDERS.length - 1);
  return -PROVIDER_SWEEP / 2 + index * step;
}

export function angleToProvider(angle: number): number {
  const step = PROVIDER_SWEEP / (PROVIDERS.length - 1);
  const index = Math.round((angle + PROVIDER_SWEEP / 2) / step);
  return Math.min(PROVIDERS.length - 1, Math.max(0, index));
}
