// T-0464: prepare a picked file for `POST /backgrounds`. The browser resizes
// the image so its largest side fits 2048 px, re-encodes it to WebP and steps
// the quality down until the bytes fit 1 MiB; the server validates all of it
// again. `load` and `encode` are injectable so tests never touch `Image` or a
// canvas.

/** The smallest side the server accepts (backgrounds run 64-2048 px). */
export const BACKGROUND_MIN_SIDE = 64;
/** The largest side the server accepts; the client scales down to fit. */
export const BACKGROUND_MAX_SIDE = 2048;
/** The server's upload cap. */
export const BACKGROUND_MAX_BYTES = 1024 * 1024;
/** WebP qualities tried in order until the result fits. */
const BACKGROUND_QUALITIES = [0.85, 0.7, 0.5];

export interface BackgroundSize {
  width: number;
  height: number;
}

export interface LoadedBackground {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Scale a size down so its largest side is at most `max`, keeping the ratio.
 * Never scales up, and never returns a fractional or zero side.
 */
export function fitWithin(
  width: number,
  height: number,
  max = BACKGROUND_MAX_SIDE,
): BackgroundSize {
  const largest = Math.max(width, height);
  if (largest <= max) {
    return { width, height };
  }
  const scale = max / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function loadFromFile(file: File): Promise<LoadedBackground> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = (): void => resolve();
      image.onerror = (): void => reject(new Error('decode'));
    });
    image.src = objectUrl;
    await loaded;
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function encodeWithCanvas(
  image: CanvasImageSource,
  size: BackgroundSize,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return Promise.resolve(null);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
  });
}

/**
 * Load a file, reject images under 64 px on either side, resize it to fit
 * 2048 px and encode WebP at 0.85, 0.7 then 0.5 until it is at most 1 MiB.
 * Throws `'too_small'` or `'too_large'` so the caller can show a plain
 * sentence.
 */
export async function prepareBackgroundImage(
  file: File,
  deps: {
    load?: (file: File) => Promise<LoadedBackground>;
    encode?: (
      image: CanvasImageSource,
      size: BackgroundSize,
      quality: number,
    ) => Promise<Blob | null>;
  } = {},
): Promise<Blob> {
  const load = deps.load ?? loadFromFile;
  const encode = deps.encode ?? encodeWithCanvas;
  const loaded = await load(file);
  if (loaded.width < BACKGROUND_MIN_SIDE || loaded.height < BACKGROUND_MIN_SIDE) {
    throw new Error('too_small');
  }
  const size = fitWithin(loaded.width, loaded.height);
  for (const quality of BACKGROUND_QUALITIES) {
    const blob = await encode(loaded.image, size, quality);
    if (blob !== null && blob.size <= BACKGROUND_MAX_BYTES) {
      return blob;
    }
  }
  throw new Error('too_large');
}
