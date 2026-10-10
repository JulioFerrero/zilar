import { Data, Effect } from 'effect';

import type { Machine, MachinesApi } from '@/lib/machines-api';
import { describeMachinesError } from './errors';

/** A failed machines call, carrying the fixed sentence the screen shows. */
export class MachineCallFailed extends Data.TaggedError('MachineCallFailed')<{
  readonly message: string;
}> {}

/** A row or dialog change: the machine that came back, or `null` when it was removed. */
export interface MachineChange {
  readonly id: string;
  readonly machine: Machine | null;
}

/** One mutation the list can run; each one's failure text is fixed. */
export type MachineMutation =
  | { readonly kind: 'approve' | 'deny' | 'revoke' | 'delete'; readonly id: string }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string };

/**
 * Runs one machines-api call. A rejection becomes the sentence for its error
 * (or the fallback), never the server's raw text.
 */
export function call<A>(attempt: () => Promise<A>, fallback: string) {
  return Effect.tryPromise({
    try: attempt,
    catch: (cause) =>
      new MachineCallFailed({ message: describeMachinesError(cause, fallback).message }),
  });
}

/** The API call behind a mutation, mapped to the change it makes in the list. */
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

/** Replaces the changed machine, or drops it when it was removed. */
export function applyChange(list: Machine[], change: MachineChange): Machine[] {
  if (change.machine === null) {
    return list.filter((m) => m.id !== change.id);
  }
  const next = change.machine;
  return list.map((m) => (m.id === change.id ? next : m));
}
