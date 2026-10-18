import type { Machine } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { MachineServiceError, type PublicMachine } from './service';

// The dates travel as ISO strings.
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

// Tells a malformed JSON body from a shape violation after decoding.
export const INVALID_JSON = Symbol('invalid-json');
