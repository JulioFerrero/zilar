// The background-images domain (T-1045). The mock never stores the uploaded
// bytes: it mints a deterministic SVG `data:` URL (plan §3, "Not worth faking")
// so the app renders the wallpaper without a second request. The contract lives
// in `@zilar/api-contract` (`backgrounds.ts`).

/** The pixel size the mock reports; the old web mock hardcoded the same pair. */
export const BACKGROUND_WIDTH = 1920;
export const BACKGROUND_HEIGHT = 1080;

/** One uploaded wallpaper row, the shape `GET /backgrounds` lists. */
export interface MockBackground {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}

/** A gradient `data:image/svg+xml` URL, used as both the row url and the bytes. */
export function backgroundDataUrl(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BACKGROUND_WIDTH}" height="${BACKGROUND_HEIGHT}" viewBox="0 0 ${BACKGROUND_WIDTH} ${BACKGROUND_HEIGHT}">`,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#334155"/>',
    '</linearGradient></defs>',
    `<rect width="${BACKGROUND_WIDTH}" height="${BACKGROUND_HEIGHT}" fill="url(#g)"/>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
