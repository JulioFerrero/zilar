// effect-plain: the byte rules moved to @zilar/chat-core (T-1525); this file
// only keeps the Blob slice and the async boundary web's prepare flow needs.
/**
 * Motion sniffing for picked sticker files (T-1501): GIF, video (WebM/MP4/MOV),
 * animated WebP and APNG keep their motion, so the editor must not draw them on
 * a canvas. The kind is read from the bytes only, never from the name or type.
 * At most the first 64 KiB are read.
 */
import { STICKER_SNIFF_BYTES, sniffMotionBytes, type MotionKind } from '@zilar/chat-core';

export type { MotionKind };

export async function sniffMotion(file: Blob): Promise<MotionKind | null> {
  const bytes = new Uint8Array(await file.slice(0, STICKER_SNIFF_BYTES).arrayBuffer());
  return sniffMotionBytes(bytes);
}
