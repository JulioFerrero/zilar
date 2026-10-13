// effect-plain: node:http transport primitive; Effect's fetch/undici client drops the Host header (T-1315)
// The internal upload fetch (T-1315). ejabberd's `mod_http_upload` serves a
// GET by finding the per-vhost upload process from the request's Host
// (`get_proc_name(Host, ?MODULE)`), so the internal fetch to
// `EJABBERD_API_URL` must carry the public host (`PUBLIC_URL`). With the
// internal host (`ejabberd:5280`) there is no such vhost and every file
// answers 404, which the routes surface as `file_unavailable` (502).
//
// Node's `fetch` (undici) treats `Host` as a forbidden header and drops it,
// so this uses `node:http`'s `request`, which sends the header as given. The
// response body stays a web `ReadableStream`, so the files route can pass it
// through without buffering and the voice route can read it into a buffer.
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export interface InternalFetchInit {
  /** The public host (`PUBLIC_URL`'s host) the upstream vhost is resolved from. */
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

/**
 * Requests an upload from ejabberd's internal base with the public `Host`.
 * The body streams as-is; a `signal` aborts the request (and any in-flight
 * body read). A refusal or transport failure rejects, like `fetch`.
 */
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
