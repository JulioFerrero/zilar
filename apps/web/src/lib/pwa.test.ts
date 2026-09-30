import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The installable app's static assets: the manifest must be valid JSON with
// the required installability fields, and the icons must be real PNGs at the
// advertised sizes (parsed from the IHDR chunk, no image dependency).

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', 'public');
const webRoot = join(here, '..', '..');

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(`${publicDir}/${path}`);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe('PWA static assets', () => {
  it('ships a valid installable manifest', () => {
    const manifest = JSON.parse(readFileSync(`${publicDir}/manifest.webmanifest`, 'utf8')) as {
      name: string;
      display: string;
      start_url: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };
    expect(manifest.name).toBe('Galena');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe('#000000');
    expect(manifest.background_color).toBe('#0a0a0a');
    const bySrc = new Map(manifest.icons.map((icon) => [icon.src, icon]));
    expect(bySrc.get('/icons/icon-192.png')).toMatchObject({ sizes: '192x192', type: 'image/png' });
    expect(bySrc.get('/icons/icon-512.png')).toMatchObject({ sizes: '512x512', type: 'image/png' });
    const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable');
    expect(maskable?.sizes).toBe('512x512');
  });

  it('ships real PNG icons at the advertised sizes', () => {
    expect(pngSize('icons/icon-192.png')).toEqual({ width: 192, height: 192 });
    expect(pngSize('icons/icon-512.png')).toEqual({ width: 512, height: 512 });
    expect(pngSize('icons/icon-maskable-512.png')).toEqual({ width: 512, height: 512 });
    expect(pngSize('icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('links the manifest, theme color and apple icon from index.html', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('apple-touch-icon');
  });
});
