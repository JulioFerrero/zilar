// The shape every mock-backend domain shares: its seed rows, the live state
// built from them, and its routes. Keeping all domains to this one shape is
// what lets `src/domains/index.ts` list them and `src/state.ts` / `src/http.ts`
// build the backend from that list alone.
import type { MockSeed } from '../data';
import type { MockRoute } from '../http/shared';
import type { MockData } from '../state';

/** The shared inputs a domain's seed factory may need (today, just the clock). */
export interface DomainContext {
  readonly now: () => Date;
}

export interface Domain {
  readonly name: string;
  /** This domain's rows, merged into the combined `MockSeed`. */
  readonly seed: (context: DomainContext) => Partial<MockSeed>;
  /** The domain's live table and mutators, built fresh from the seed. */
  readonly createState: (seed: MockSeed) => Partial<MockData>;
  /** The domain's route handler; domains with no route default to a no-op. */
  readonly routes: MockRoute;
}

export function defineDomain(domain: {
  name: string;
  seed?: (context: DomainContext) => Partial<MockSeed>;
  createState?: (seed: MockSeed) => Partial<MockData>;
  routes?: MockRoute;
}): Domain {
  return {
    name: domain.name,
    seed: domain.seed ?? (() => ({})),
    createState: domain.createState ?? (() => ({})),
    routes: domain.routes ?? (() => undefined),
  };
}
