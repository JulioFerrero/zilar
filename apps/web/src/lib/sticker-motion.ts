// effect-plain: the Blob slice and the async boundary web's prepare flow needs; the byte
// rules live in @zilar/chat-core.
import { STICKER_SNIFF_BYTES, sniffMotionBytes, type MotionKind } from '@zilar/chat-core';

export type { MotionKind };

export async function sniffMotion(file: Blob): Promise<MotionKind | null> {
  const bytes = new Uint8Array(await file.slice(0, STICKER_SNIFF_BYTES).arrayBuffer());
  return sniffMotionBytes(bytes);
}
