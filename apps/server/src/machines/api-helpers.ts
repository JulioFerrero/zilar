// Private helpers of the machines API (`api.ts`, T-1127), split out to keep
// that file under the 400-line limit.

import type { Machine } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { MachineServiceError, type PublicMachine } from './service';

// The wire form of a `PublicMachine`: the dates as the ISO strings
// `JSON.stringify` produced on the old route.
export function toMachineView(machine: PublicMachine): Machine {
  return {
    ...machine,
    createdAt: machine.createdAt.toISOString(),
    approvedAt: machine.approvedAt?.toISOString() ?? null,
    lastSeenAt: machine.lastSeenAt?.toISOString() ?? null,
  };
}

export function invalidCode(): HttpError {
  return new HttpError(400, 'invalid_code', 'Invalid or expired pairing code');
}

export function toConflict(error: unknown): unknown {
  if (error instanceof MachineServiceError) {
    return new HttpError(409, error.errorCode, error.message);
  }
  throw error;
}

// Used to tell a malformed JSON body from a shape violation after the sentinel
// has been replaced by the decoded value.
export const INVALID_JSON = Symbol('invalid-json');
