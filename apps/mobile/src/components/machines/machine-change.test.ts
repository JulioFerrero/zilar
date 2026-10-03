import { describe, expect, it } from 'vitest';

import { MachinesApiError, type MachinesApi } from '@/lib/machines-api';
import { applyMachineChange } from './machine-change';

function fakeApi(setAiMachine: MachinesApi['setAiMachine']): MachinesApi {
  return {
    listMachines: () => Promise.resolve([]),
    createPairingCode: () => Promise.resolve({ code: 'x', expiresAt: 't' }),
    approveMachine: () => Promise.reject(new Error('unused')),
    denyMachine: () => Promise.resolve(),
    revokeMachine: () => Promise.reject(new Error('unused')),
    renameMachine: () => Promise.reject(new Error('unused')),
    deleteMachine: () => Promise.resolve(),
    setAiMachine,
  };
}

// A raw server message no user-facing text may ever repeat back.
const RAW = 'raw server text: invalid_transition on machine m-9';

describe('applyMachineChange', () => {
  it('shows the PUT answer on success', async () => {
    const api = fakeApi(async () => 'm-2');

    await expect(applyMachineChange(api, 'a-1', 'm-2', 'm-1')).resolves.toEqual({
      home: 'm-2',
      error: '',
    });
  });

  it('restores the previous machine and shows a fixed sentence on failure', async () => {
    const api = fakeApi(async () => {
      throw new MachinesApiError(409, 'invalid_transition', RAW);
    });

    const outcome = await applyMachineChange(api, 'a-1', 'm-2', 'm-1');
    expect(outcome.home).toBe('m-1');
    expect(outcome.error).toBe('That machine changed. Reload the list and try again.');
    expect(outcome.error).not.toContain(RAW);
  });

  // Finding 3: the route throws `MachinesApiError`, so the AI mapper (which
  // falls back to the raw message) must never see it. An unmapped code with
  // a raw message answers the fallback, never the raw text.
  it('never surfaces the raw server text for an unmapped machines error', async () => {
    const api = fakeApi(async () => {
      throw new MachinesApiError(503, 'something_new', RAW);
    });

    const outcome = await applyMachineChange(api, 'a-1', null, 'm-1');
    expect(outcome.home).toBe('m-1');
    expect(outcome.error).toBe('Could not update the home machine.');
    expect(outcome.error).not.toContain('raw server text');
  });
});
