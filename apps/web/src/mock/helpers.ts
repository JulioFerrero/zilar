export interface MockGifItem {
  id: string;
  title: string;
  mediaToken: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
}

/**
 * Generated GIF-like placeholders for mock mode (T-0122): animated-feeling
 * SVG art the panel can show with no server. The `mediaToken` is a display
 * key only — mock mode never calls the proxy.
 */
function mockGifArt(from: string, to: string, glyph: string): string {
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

export function mockGifItems(): MockGifItem[] {
  const cells: Array<[string, string, string, string]> = [
    ['mock-gif-1', '#fbbf24', '#f97316', '🐱 dancing'],
    ['mock-gif-2', '#a78bfa', '#7c3aed', '😹 laughing'],
    ['mock-gif-3', '#6ee7b7', '#059669', '🙀 surprised'],
    ['mock-gif-4', '#fda4af', '#e11d48', '😻 in love'],
    ['mock-gif-5', '#7dd3fc', '#0284c7', '🐈 strutting'],
    ['mock-gif-6', '#fde68a', '#d97706', '😺 waving'],
  ];
  return cells.map(([id, from, to, title]) => ({
    id,
    title,
    mediaToken: mockGifArt(from, to, [...title][0] ?? ''),
    kind: 'image' as const,
    width: 200,
    height: 150,
  }));
}
