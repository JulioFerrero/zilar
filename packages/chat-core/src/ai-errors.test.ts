import { describe, expect, it } from 'vitest';
import { describeAiFailure } from './ai-errors';

describe('describeAiFailure', () => {
  it('maps ais_unavailable to the unavailable state', () => {
    expect(describeAiFailure({ code: 'ais_unavailable', status: 503, message: 'x' })).toEqual({
      message: "AI management isn't configured on this server.",
      unavailable: true,
    });
  });

  it('maps connection and provisioning errors', () => {
    expect(
      describeAiFailure({ code: 'invalid_connection', status: 400, message: 'x' }).message,
    ).toBe("That connection can't be used. Pick another one or re-add it.");
    expect(
      describeAiFailure({ code: 'ai_provisioning_failed', status: 502, message: 'x' }).message,
    ).toContain("The server couldn't finish");
  });

  it('keeps the server message for other codes', () => {
    expect(
      describeAiFailure({ code: 'invalid_request', status: 400, message: 'name too long' }),
    ).toEqual({
      message: 'name too long',
      unavailable: false,
    });
  });
});
