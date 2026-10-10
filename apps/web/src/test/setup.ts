import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lazy route pages load their chunk on first render; a cold import can take longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrollIntoView, which the message list uses to bring
// the unread divider into view.
Element.prototype.scrollIntoView = () => {};

// T-0864: `vmThreads` gives every test file its own realm, but Node's
// `Response` hands out `ArrayBuffer`s of the host realm. Effect's HTTP client
// decodes a body only from an `ArrayBuffer` of the current realm
// (`instanceof`), as a browser always provides, so the bytes are copied into
// this file's realm. `Response` may be shared by the realms of one worker:
// the original method is kept once and re-wrapped per file, never stacked.
const hostArrayBuffer = Symbol.for('zilar.test.hostArrayBuffer');
const responseProto = Response.prototype as Response & {
  [hostArrayBuffer]?: Response['arrayBuffer'];
};
const readHostArrayBuffer = (responseProto[hostArrayBuffer] ??= responseProto.arrayBuffer);
responseProto.arrayBuffer = async function arrayBuffer(this: Response) {
  const body = await readHostArrayBuffer.call(this);
  return body instanceof ArrayBuffer ? body : new Uint8Array(new Uint8Array(body)).buffer;
};
