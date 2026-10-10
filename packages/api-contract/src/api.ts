import { HttpApi } from 'effect/http-api';
import { PinsGroup } from './pins';

/**
 * The whole HTTP API as one contract. Clients derive from it
 * (`makeZilarClient`); each server module still builds its own `HttpApi`
 * from its group until the modules are mounted as one API.
 */
export const ZilarApi = HttpApi.make('zilar').add(PinsGroup);
