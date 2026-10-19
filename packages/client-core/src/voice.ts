import type { UploadSlot } from '@zilar/xmpp-core';

/** Anything that can hand out a XEP-0363 upload slot. */
export interface UploadSlotRequester {
  requestUploadSlot(request: {
    filename: string;
    size: number;
    contentType: string;
  }): Promise<UploadSlot>;
}
