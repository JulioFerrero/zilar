import { Data, Effect } from 'effect';

import type { MachinesApi } from '@zilar/client-core';
import { describeMachinesError } from './errors';
import type { Machine } from '@zilar/api-contract';

export class MachineCallFailed extends Data.TaggedError('MachineCallFailed')<{
  readonly message: string;
}> {}

export interface MachineChange {
  readonly id: string;
  readonly machine: Machine | null;
}

export type MachineMutation =
  | { readonly kind: 'approve' | 'deny' | 'revoke' | 'delete'; readonly id: string }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string };

/**
 * Runs one machines-api call; a rejection becomes the sentence for its error
 * (or the fallback), never the server's raw text.
 */
export function call<A>(attempt: () => Promise<A>, fallback: string) {
  return Effect.tryPromise({
    try: attempt,
    catch: (cause) =>
      new MachineCallFailed({ message: describeMachinesError(cause, fallback).message }),
  });
}

export function mutationCall(
  api: MachinesApi,
  input: MachineMutation,
): Effect.Effect<MachineChange, MachineCallFailed> {
  switch (input.kind) {
    case 'approve':
      return call(() => api.approveMachine(input.id), 'Could not approve the machine.').pipe(
        Effect.map((machine) => ({ id: input.id, machine })),
      );
    case 'deny':
      return call(() => api.denyMachine(input.id), 'Could not deny the machine.').pipe(
        Effect.map(() => ({ id: input.id, machine: null })),
      );
    case 'rename':
      return call(
        () => api.renameMachine(input.id, input.name),
        'Could not rename the machine.',
      ).pipe(Effect.map((machine) => ({ id: input.id, machine })));
    case 'revoke':
      return call(() => api.revokeMachine(input.id), 'Could not revoke the machine.').pipe(
        Effect.map((machine) => ({ id: input.id, machine })),
      );
    case 'delete':
      return call(() => api.deleteMachine(input.id), 'Could not delete the machine.').pipe(
        Effect.map(() => ({ id: input.id, machine: null })),
      );
  }
}

export function applyChange(list: Machine[], change: MachineChange): Machine[] {
  if (change.machine === null) {
    return list.filter((m) => m.id !== change.id);
  }
  const next = change.machine;
  return list.map((m) => (m.id === change.id ? next : m));
}
