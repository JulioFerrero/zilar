// The GIF seed (T-1046): the six generated placeholders web and mobile already
// ship (`apps/web/src/mock/helpers.ts:203`, `apps/mobile/src/mock/gifs.ts:34`).
// Each `mediaToken` is a `data:image/svg+xml` URL, not an opaque proxy token,
// because the shared backend does not fake the `/gifs/media/:token` proxy
// (docs/audit/mock-plan.md §3): the panel renders the art with no network.
import type { GifResult } from '@zilar/api-contract';

const CELLS: ReadonlyArray<readonly [id: string, from: string, to: string, title: string]> = [
  ['mock-gif-1', '#fbbf24', '#f97316', '🐱 dancing'],
  ['mock-gif-2', '#a78bfa', '#7c3aed', '😹 laughing'],
  ['mock-gif-3', '#6ee7b7', '#059669', '🙀 surprised'],
  ['mock-gif-4', '#fda4af', '#e11d48', '😻 in love'],
  ['mock-gif-5', '#7dd3fc', '#0284c7', '🐈 strutting'],
  ['mock-gif-6', '#fde68a', '#d97706', '😺 waving'],
];

function gifArt(from: string, to: string, glyph: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<rect width="200" height="150" rx="24" fill="url(#g)"/>',
    `<text x="100" y="98" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="64">${glyph}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The demo GIFs, rebuilt per call so tests cannot share mutable rows. */
export function mockGifItems(): GifResult[] {
  return CELLS.map(([id, from, to, title]) => ({
    id,
    title,
    mediaToken: gifArt(from, to, [...title][0] ?? ''),
    kind: 'image',
    width: 200,
    height: 150,
  }));
}
