// effect-plain: node:http transport primitive; Effect's fetch/undici client drops the Host header
// ejabberd resolves the upload vhost from the Host header, and undici drops `Host` as a
// forbidden header, so this uses `node:http`'s `request`.
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export interface InternalFetchInit {
  host: string;
  /** Only the caller's Range header crosses into ejabberd. */
  range?: string;
  signal?: AbortSignal;
}

export interface InternalFetchResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

export type InternalFetch = (
  url: string,
  init: InternalFetchInit,
) => Promise<InternalFetchResponse>;

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

export const defaultInternalFetch: InternalFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const send = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: 'GET',
        headers: {
          host: init.host,
          ...(init.range === undefined ? {} : { range: init.range }),
        },
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 502,
          headers: toHeaders(response.headers),
          body: Readable.toWeb(response) as ReadableStream<Uint8Array>,
        });
      },
    );
    const abort = (): void => {
      request.destroy(new Error('The internal fetch was aborted'));
    };
    if (init.signal?.aborted === true) {
      abort();
      return;
    }
    init.signal?.addEventListener('abort', abort, { once: true });
    request.once('error', reject);
    request.end();
  });
