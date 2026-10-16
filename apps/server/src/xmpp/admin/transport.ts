import { Exit, Schema } from 'effect';
import type { XmppConfig } from '../config';
import { EjabberdApiError, errorText, isErrorBody } from './errors';
import { MutationResultSchema } from './schemas';
import type { ApiResponse, FetchLike } from './types';

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

export function createAdminTransport(config: XmppConfig, fetchImpl: FetchLike) {
  async function call(command: string, body: Record<string, unknown>): Promise<ApiResponse> {
    const response = await fetchImpl(`${config.apiUrl}/${command}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(config.adminJid, config.adminPassword),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, ok: response.ok, body: parsed };
  }

  function fail(command: string, response: ApiResponse, detail?: string): never {
    throw new EjabberdApiError(command, response.status, detail ?? errorText(response.body));
  }

  function expectOk(command: string, response: ApiResponse): unknown {
    if (!response.ok || isErrorBody(response.body)) {
      fail(command, response);
    }
    return response.body;
  }

  function expectMutationResult(command: string, response: ApiResponse): void {
    const result = expectOk(command, response);
    const parsed = Schema.decodeUnknownExit(MutationResultSchema)(result);
    if (Exit.isFailure(parsed)) {
      fail(command, response, `unexpected result: ${errorText(result)}`);
    }
  }

  return { call, fail, expectOk, expectMutationResult };
}
