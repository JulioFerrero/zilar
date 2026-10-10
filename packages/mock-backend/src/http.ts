// effect-plain: in-memory mock backend; the delay mirrors the old mock's
// setTimeout and the matching itself is pure

// The mock HTTP layer. `createMockHttp(data)` returns a handler shaped like
// `fetch` minus the network: it answers `/me`, `/chats`, `/contacts`, the AI
// routes (`/ais`, `/ai-memory`, `/connections`, `/machines`) and the
// approvals/audit/tools/routines routes from the in-memory seed, and returns
// `undefined` for every other path.
//
// The `undefined` contract matters for the app cutovers (plan tasks G and H):
// the app dispatcher tries this backend first and, on `undefined`, falls back to
// the old per-app mock routes until the migration is complete. A path and method
// this backend serves always answer a `Response`; anything else answers
// `undefined`.
import type { MockData } from './state';
import { handleAiMemory } from './http/ai-memory';
import { handleAis } from './http/ais';
import { handleApprovalRules } from './http/approval-rules';
import { handleApprovals } from './http/approvals';
import { handleAudit } from './http/audit';
import { handleChats } from './http/chats';
import { handleConnections } from './http/connections';
import { handleContacts } from './http/contacts';
import { handleMachines } from './http/machines';
import { handleMe } from './http/me';
import { handleRoutines } from './http/routines';
import { handleTools } from './http/tools';
import { DEFAULT_DELAY_MS, parseRequest, type MockRoute } from './http/shared';

export { DEFAULT_DELAY_MS };

export type MockHttp = (path: string, init?: RequestInit) => Promise<Response | undefined>;

const routes: readonly MockRoute[] = [
  handleMe,
  handleChats,
  handleContacts,
  handleAis,
  handleAiMemory,
  handleConnections,
  handleMachines,
  handleApprovals,
  handleApprovalRules,
  handleAudit,
  handleTools,
  handleRoutines,
];

export function createMockHttp(
  data: MockData,
  getDelayMs: () => number = () => DEFAULT_DELAY_MS,
): MockHttp {
  return async (path, init = {}) => {
    await delay(getDelayMs());
    const request = parseRequest(path, init);
    for (const route of routes) {
      const response = route(data, request);
      if (response !== undefined) {
        return response;
      }
    }
    return undefined;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
