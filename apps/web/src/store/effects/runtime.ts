// The lifetime of one chat store (store Scope, session Scopes, keyed fibers)
// lives in `@zilar/client-core/store`. This file binds it to web's `Ports`.
import { makeLifetime as makeCoreLifetime } from '@zilar/client-core/store';
import type {
  Fibers as CoreFibers,
  Lifetime as CoreLifetime,
  Task as CoreTask,
} from '@zilar/client-core/store';
import { Context } from 'effect';
import { Ports, type PortsShape } from './ports';

export type Task = CoreTask<Ports>;
export type Fibers = CoreFibers<Ports>;
export type Lifetime = CoreLifetime<Ports>;

export function makeLifetime(ports: PortsShape): Lifetime {
  return makeCoreLifetime(Context.make(Ports, ports));
}
