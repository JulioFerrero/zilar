import { API_URL } from './auth';

/**
 * The machines (runners) API (`/api/machines`), the mobile twin of the web
 * client in `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/machines/routes.ts` and `apps/server/src/machines/service.ts`.
 *
 * Mobile has no zod, so — like `ais-api.ts` — the boundary is validated with
 * type guards. `MachinesApiError` keeps the server's `code` and `status`, so
 * screens can branch on the error without parsing the message again.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isMachineStatus(value: unknown): value is MachineStatus {
  return value === 'pending' || value === 'approved' || value === 'revoked';
}

function parseMachine(value: unknown): Machine | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const status = value['status'];
  const os = value['os'];
  const osVersion = value['osVersion'];
  const arch = value['arch'];
  const cpu = value['cpu'];
  const cores = value['cores'];
  const ramGb = value['ramGb'];
  const diskFreeGb = value['diskFreeGb'];
  const drivers = value['drivers'];
  const fingerprint = value['fingerprint'];
  const createdAt = value['createdAt'];
  const approvedAt = value['approvedAt'];
  const lastSeenAt = value['lastSeenAt'];
  const online = value['online'];
  if (
    !isString(id) ||
    !isString(name) ||
    !isMachineStatus(status) ||
    !isString(os) ||
    !isString(osVersion) ||
    !isString(arch) ||
    !isString(cpu) ||
    typeof cores !== 'number' ||
    typeof ramGb !== 'number' ||
    typeof diskFreeGb !== 'number' ||
    !Array.isArray(drivers) ||
    !drivers.every(isString) ||
    !isString(fingerprint) ||
    !isString(createdAt) ||
    !(approvedAt === null || isString(approvedAt)) ||
    !(lastSeenAt === null || isString(lastSeenAt)) ||
    !(online === undefined || typeof online === 'boolean')
  ) {
    return null;
  }
  return {
    id,
    name,
    status,
    os,
    osVersion,
    arch,
    cpu,
    cores,
    ramGb,
    diskFreeGb,
    drivers,
    fingerprint,
    createdAt,
    approvedAt,
    lastSeenAt,
    ...(online === undefined ? {} : { online }),
  };
}

function parsePairingCode(value: unknown): PairingCode | null {
  if (!isRecord(value)) return null;
  const code = value['code'];
  const expiresAt = value['expiresAt'];
  if (!isString(code) || !isString(expiresAt)) return null;
  return { code, expiresAt };
}

/** The AI's home machine id, read off the server's fresh public AI. */
function parseMachineId(value: unknown): { machineId: string | null } | null {
  if (!isRecord(value)) return null;
  const machineId = value['machineId'];
  if (machineId === null || isString(machineId)) return { machineId };
  return null;
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new MachinesApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new MachinesApiError(response.status, code, message);
  }
  return body;
}

/** The production `MachinesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createMachinesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): MachinesApi {
  const withToken = async <T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T | null,
  ): Promise<T> => {
    const token = await getToken();
    if (token === undefined) {
      throw new MachinesApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new MachinesApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  const parseList = (value: unknown): Machine[] | null => {
    if (!Array.isArray(value)) return null;
    const parsed: Machine[] = [];
    for (const item of value) {
      const result = parseMachine(item);
      if (result === null) return null;
      parsed.push(result);
    }
    return parsed;
  };

  return {
    async listMachines() {
      return withToken('/api/machines', { method: 'GET' }, parseList);
    },
    async createPairingCode() {
      return withToken('/api/machines/pairing-codes', { method: 'POST' }, parsePairingCode);
    },
    async approveMachine(id) {
      return withToken(
        `/api/machines/${encodeURIComponent(id)}/approve`,
        { method: 'POST' },
        parseMachine,
      );
    },
    async denyMachine(id) {
      await withToken(`/api/machines/${encodeURIComponent(id)}/deny`, { method: 'POST' }, () => ({
        ok: true,
      }));
    },
    async revokeMachine(id) {
      return withToken(
        `/api/machines/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
        parseMachine,
      );
    },
    async renameMachine(id, name) {
      return withToken(
        `/api/machines/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
        parseMachine,
      );
    },
    async deleteMachine(id) {
      await withToken(`/api/machines/${encodeURIComponent(id)}`, { method: 'DELETE' }, () => ({
        ok: true,
      }));
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
      return parsed.machineId;
    },
  };
}
