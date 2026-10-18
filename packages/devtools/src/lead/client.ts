// Barrel over `client/`: every importer keeps using `./client.js`.

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
