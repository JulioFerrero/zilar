// `lead/client.ts` is split under `client/` (T-1468). Every importer keeps
// using `./client.js`; this barrel re-exports the same names it always did.

export type {
  CreateSessionOptions,
  OpenCodeClient,
  PermissionDecision,
  SessionModel,
} from './client/interface.js';
export { readDataPayload } from './client/payload.js';
export { OpencodeCliClient } from './client/opencode-cli.js';
export type { FakeSession, InterruptOutcome } from './client/fake.js';
export { FakeOpenCodeClient } from './client/fake.js';
