import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';

/**
 * The machines (runners) API (`/api/machines`), the mobile twin of the web
 * client in `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/machines/api.ts` and `apps/server/src/machines/service.ts`.
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `MachinesApiError` keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again.
 *
 * `setAiMachine` mirrors web's `setAiMachine`: the AI's home machine is a
 * separate route on purpose, not part of the general PATCH.
 */

export type MachineStatus = 'pending' | 'approved' | 'revoked';

export interface Machine {
  id: string;
  name: string;
  status: MachineStatus;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  diskFreeGb: number;
  drivers: string[];
  fingerprint: string;
  createdAt: string;
  approvedAt: string | null;
  lastSeenAt: string | null;
  online?: boolean | undefined;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export interface MachinesApi {
  listMachines(): Promise<Machine[]>;
  createPairingCode(): Promise<PairingCode>;
  approveMachine(id: string): Promise<Machine>;
  denyMachine(id: string): Promise<void>;
  revokeMachine(id: string): Promise<Machine>;
  renameMachine(id: string, name: string): Promise<Machine>;
  deleteMachine(id: string): Promise<void>;
  /**
   * Assigns the AI's home machine (`null` clears it back to the platform).
   * Answers the new `machineId` parsed from the server's fresh public AI.
   */
  setAiMachine(aiId: string, machineId: string | null): Promise<string | null>;
}

export class MachinesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MachinesApiError';
    this.status = status;
    this.code = code;
  }
}

const MachineStatusSchema = Schema.Literals(['pending', 'approved', 'revoked']);

const MachineSchema = struct({
  id: Schema.String,
  name: Schema.String,
  status: MachineStatusSchema,
  os: Schema.String,
  osVersion: Schema.String,
  arch: Schema.String,
  cpu: Schema.String,
  cores: Schema.Number,
  ramGb: Schema.Number,
  diskFreeGb: Schema.Number,
  drivers: Schema.mutable(Schema.Array(Schema.String)),
  fingerprint: Schema.String,
  createdAt: Schema.String,
  approvedAt: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.String),
  online: Schema.optional(Schema.Boolean),
});

// The list is a bare array (not an envelope); `Array` is made mutable to keep
// the `Machine[]` type the API has always returned.
const MachineListSchema = Schema.mutable(Schema.Array(MachineSchema));

const PairingCodeSchema = struct({
  code: Schema.String,
  expiresAt: Schema.String,
});

/** The AI's home machine id, read off the server's fresh public AI. */
const MachineIdSchema = struct({
  machineId: Schema.NullOr(Schema.String),
});

function parseMachine(value: unknown): Machine | null {
  const decoded = Schema.decodeUnknownExit(MachineSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parsePairingCode(value: unknown): PairingCode | null {
  const decoded = Schema.decodeUnknownExit(PairingCodeSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseMachineId(value: unknown): { machineId: string | null } | null {
  const decoded = Schema.decodeUnknownExit(MachineIdSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// deny/delete answer 204 with no body; any 2xx body is accepted and ignored,
// exactly like the old hand validator.
function parseIgnored(value: unknown): Record<string, never> | null {
  const decoded = Schema.decodeUnknownExit(Schema.Unknown)(value);
  return Exit.isSuccess(decoded) ? {} : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `MachinesApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class MachinesNetworkError extends Data.TaggedError('MachinesNetworkError') {}
class MachinesRequestError extends Data.TaggedError('MachinesRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class MachinesUnauthorized extends Data.TaggedError('MachinesUnauthorized') {}
class MachinesInvalidResponse extends Data.TaggedError('MachinesInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, MachinesNetworkError | MachinesRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new MachinesNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new MachinesRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `MachinesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createMachinesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): MachinesApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    MachinesUnauthorized | MachinesNetworkError | MachinesRequestError | MachinesInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new MachinesUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new MachinesInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          MachinesUnauthorized: () =>
            Effect.fail(new MachinesApiError(401, 'unauthorized', 'No session')),
          MachinesNetworkError: () =>
            Effect.fail(new MachinesApiError(0, 'network_error', 'Could not reach the server')),
          MachinesRequestError: (error) =>
            Effect.fail(new MachinesApiError(error.status, error.code, error.message)),
          MachinesInvalidResponse: () =>
            Effect.fail(
              new MachinesApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  const parseList = (value: unknown): Machine[] | null => {
    const decoded = Schema.decodeUnknownExit(MachineListSchema)(value);
    return Exit.isSuccess(decoded) ? decoded.value : null;
  };

  return {
    async listMachines() {
      const body = await withToken('/api/machines', { method: 'GET' }, parseList);
      return body as Machine[];
    },
    async createPairingCode() {
      const body = await withToken(
        '/api/machines/pairing-codes',
        { method: 'POST' },
        parsePairingCode,
      );
      return body as PairingCode;
    },
    async approveMachine(id) {
      const body = await withToken(
        `/api/machines/${encodeURIComponent(id)}/approve`,
        { method: 'POST' },
        parseMachine,
      );
      return body as Machine;
    },
    async denyMachine(id) {
      await withToken(
        `/api/machines/${encodeURIComponent(id)}/deny`,
        { method: 'POST' },
        parseIgnored,
      );
    },
    async revokeMachine(id) {
      const body = await withToken(
        `/api/machines/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
        parseMachine,
      );
      return body as Machine;
    },
    async renameMachine(id, name) {
      const body = await withToken(
        `/api/machines/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
        parseMachine,
      );
      return body as Machine;
    },
    async deleteMachine(id) {
      await withToken(
        `/api/machines/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parseIgnored,
      );
    },
    async setAiMachine(aiId, machineId) {
      const parsed = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/machine`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ machineId }),
        },
        parseMachineId,
      );
      return (parsed as { machineId: string | null }).machineId;
    },
  };
}
