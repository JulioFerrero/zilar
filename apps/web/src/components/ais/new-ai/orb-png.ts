import { Effect } from 'effect';
import { orbDataUri } from '@zilar/chat-core';

// `@zilar/ball-avatar` is not a web dependency; the orb parameters come back
// from `orbDataUri`, so this names the same shape without importing it.
type OrbParams = Parameters<typeof orbDataUri>[0];

const ORB_PNG_SIDE = 256;

/**
 * Renders the orb's SVG data URI to a 256×256 PNG; a null blob means the
 * browser could not decode or encode the image.
 */
export function orbPngBlob(params: OrbParams, idSeed: string): Effect.Effect<Blob | null> {
  return Effect.callback<Blob | null>((resume) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ORB_PNG_SIDE;
      canvas.height = ORB_PNG_SIDE;
      const context = canvas.getContext('2d');
      if (context === null) {
        resume(Effect.succeed(null));
        return;
      }
      context.drawImage(image, 0, 0, ORB_PNG_SIDE, ORB_PNG_SIDE);
      canvas.toBlob((blob) => resume(Effect.succeed(blob)), 'image/png');
    };
    image.onerror = () => resume(Effect.succeed(null));
    image.src = orbDataUri(params, idSeed);
    return Effect.sync(() => {
      image.onload = null;
      image.onerror = null;
    });
  });
}
