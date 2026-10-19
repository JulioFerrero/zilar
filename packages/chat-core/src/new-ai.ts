// `chat-core` deliberately does not depend on `@zilar/api-contract`, so the catalog is a small structural view the wire type fits.

import type { BallParams } from '@zilar/ball-avatar';

import { LLM_PROVIDERS, providerLabel } from './ai';

const COMPATIBLE_ID = 'openai-compatible';

export interface CatalogProviderView {
  readonly id: string;
  readonly name: string;
  readonly docUrl?: string;
}

export interface CatalogView {
  readonly providers: readonly CatalogProviderView[];
}

export interface ProviderChoice {
  readonly id: string;
  readonly label: string;
  readonly hasKey: boolean;
}

export interface ProviderConnectionView {
  readonly provider: string;
  readonly status: string;
}

// A-Z ignoring case, without leaning on a locale.
function byLabel(left: { label: string }, right: { label: string }): number {
  const a = left.label.toLowerCase();
  const b = right.label.toLowerCase();
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

// OpenAI, Anthropic, then the rest by label A-Z, then OpenAI-compatible last; a null catalog falls back to the built-in list.
export function providerChoices(
  catalog: CatalogView | null,
  connections: readonly ProviderConnectionView[],
): ProviderChoice[] {
  const active = new Set(
    connections.filter((connection) => connection.status === 'active').map((c) => c.provider),
  );

  const catalogProviders =
    catalog === null
      ? LLM_PROVIDERS.map((provider) => ({ id: provider.id, label: provider.label }))
      : catalog.providers.map((provider) => ({ id: provider.id, label: provider.name }));

  // OpenAI-compatible is a pinned action, never a catalog row.
  const rows = catalogProviders.filter((provider) => provider.id !== COMPATIBLE_ID);
  const first = (id: string) => rows.find((provider) => provider.id === id);
  const pinned = [first('openai'), first('anthropic')].filter(
    (provider): provider is { id: string; label: string } => provider !== undefined,
  );
  const rest = rows
    .filter((provider) => provider.id !== 'openai' && provider.id !== 'anthropic')
    .sort(byLabel);

  return [...pinned, ...rest, { id: COMPATIBLE_ID, label: providerLabel(COMPATIBLE_ID) }].map(
    (provider) => ({ ...provider, hasKey: active.has(provider.id) }),
  );
}

const KEY_PAGES: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  xai: 'https://console.x.ai',
  openrouter: 'https://openrouter.ai/keys',
};

export function keyPageFor(providerId: string, catalog: CatalogView | null): string | null {
  const known = KEY_PAGES[providerId];
  if (known !== undefined) {
    return known;
  }
  const docUrl = catalog?.providers.find((provider) => provider.id === providerId)?.docUrl;
  return docUrl !== undefined && docUrl !== '' ? docUrl : null;
}

const KEY_PLACEHOLDERS: Record<string, string> = {
  openai: 'sk-…',
  deepseek: 'sk-…',
  anthropic: 'sk-ant-…',
  google: 'AIza…',
  xai: 'xai-…',
  openrouter: 'sk-or-…',
};

export function keyPlaceholderFor(providerId: string): string {
  return KEY_PLACEHOLDERS[providerId] ?? 'Paste your key';
}

// The server's five fixed messages map one-to-one; anything else falls back to one sentence, so raw server text never reaches the user.
export function keyCheckMessage(label: string, serverMessage: string): string {
  switch (serverMessage) {
    case 'The provider rejected the key':
      return `${label} did not accept this key. Check that you copied all of it.`;
    case 'The provider is rate-limiting this key. Try again in a minute.':
      return `${label} is limiting this key right now. Wait a minute and try again.`;
    case 'The provider returned an unexpected response':
      return `${label} gave an unexpected answer. Try again.`;
    case 'The provider is unreachable':
      return `Could not reach ${label}. Check the address and try again.`;
    case 'Too many key tests, try again in a minute':
      return 'Too many checks. Wait a minute and try again.';
    default:
      return 'Could not check the key. Try again.';
  }
}

export interface OrbChoice {
  readonly value: number;
  readonly name: string;
}

export const ORB_HUES: readonly OrbChoice[] = [
  { value: 0, name: 'Red' },
  { value: 18, name: 'Coral' },
  { value: 32, name: 'Orange' },
  { value: 45, name: 'Amber' },
  { value: 58, name: 'Yellow' },
  { value: 90, name: 'Lime' },
  { value: 140, name: 'Green' },
  { value: 165, name: 'Teal' },
  { value: 190, name: 'Cyan' },
  { value: 215, name: 'Blue' },
  { value: 240, name: 'Indigo' },
  { value: 265, name: 'Violet' },
  { value: 290, name: 'Purple' },
  { value: 320, name: 'Pink' },
];

export const ORB_RIMS: readonly OrbChoice[] = [
  { value: 300, name: 'Magenta' },
  { value: 200, name: 'Ice' },
  { value: 160, name: 'Mint' },
  { value: 50, name: 'Gold' },
  { value: 20, name: 'Ember' },
  { value: 260, name: 'Lilac' },
  { value: 0, name: 'Rose' },
];

// The light stays inside 0.4 of the radius, as the board clamps the drag.
export const ORB_MAX_DISTANCE = 0.4;

export interface OrbLight {
  readonly angle: number;
  readonly distance: number;
}

export function clampOrbLight(angle: number, distance: number): OrbLight {
  return { angle, distance: Math.min(ORB_MAX_DISTANCE, Math.max(0, distance)) };
}

// A random hue and rim, and a light at 0.18-0.36 from the centre; `random` is injected so tests can make it deterministic.
export function shuffleOrb(random: () => number): BallParams {
  const angle = random() * Math.PI * 2;
  const spread = 18 + random() * 18;
  return {
    hue: Math.round(random() * 360),
    rim: Math.round(random() * 360),
    angle,
    distance: clampOrbLight(angle, spread / 100).distance,
  };
}
