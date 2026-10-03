import { describe, expect, it } from 'vitest';
import { derivePhase, formatAge, sortActive, type PhaseInput, type SnapshotTask } from './snapshot';

const base: PhaseInput = {
  taskStatus: 'in-progress',
  sessionState: 'running',
  quotaError: false,
  autoFixRounds: 0,
  prereviewForHead: false,
  prereviewSessionState: 'none',
  prereviewFilePresent: false,
  packetReady: false,
};

describe('derivePhase', () => {
  it('codes while the worker runs and the task is not in review', () => {
    expect(derivePhase(base).id).toBe('coding');
  });

  it('reports blocked and quota first', () => {
    expect(derivePhase({ ...base, taskStatus: 'blocked' })).toMatchObject({
      id: 'blocked',
      needsLead: true,
    });
    expect(derivePhase({ ...base, quotaError: true }).id).toBe('quota');
  });

  it('walks the review: starting, running, waiting for the lead', () => {
    const review = { ...base, taskStatus: 'review', sessionState: 'idle' };
    expect(derivePhase(review).id).toBe('starting-prereview');
    expect(
      derivePhase({ ...review, prereviewForHead: true, prereviewSessionState: 'running' }).id,
    ).toBe('prereview');
    expect(
      derivePhase({
        ...review,
        prereviewForHead: true,
        prereviewSessionState: 'idle',
        prereviewFilePresent: true,
        packetReady: true,
      }),
    ).toMatchObject({ id: 'waiting-lead', needsLead: true });
  });

  it('names the automatic round while the worker fixes findings', () => {
    const phase = derivePhase({ ...base, taskStatus: 'review', autoFixRounds: 2 });
    expect(phase).toMatchObject({ id: 'fixing', label: 'Fixing review findings (auto round 2)' });
  });

  it('flags an idle worker that never reached review', () => {
    expect(derivePhase({ ...base, sessionState: 'idle' })).toMatchObject({
      id: 'idle',
      needsLead: true,
    });
  });
});

describe('formatAge', () => {
  it('formats minutes, hours and days', () => {
    expect(formatAge(20_000)).toBe('under 1 min');
    expect(formatAge(5 * 60_000)).toBe('5 min');
    expect(formatAge(80 * 60_000)).toBe('1 h 20 min');
    expect(formatAge(120 * 60_000)).toBe('2 h');
    expect(formatAge(27 * 3_600_000)).toBe('1 d 3 h');
  });
});

describe('sortActive', () => {
  it('puts the tasks that need the lead first', () => {
    const task = (id: string, needsLead: boolean): SnapshotTask => ({
      id,
      title: '',
      model: '',
      phase: { id: 'coding', label: '', needsLead },
      phaseSince: '',
      phaseAge: '',
      startedAt: '',
      totalAge: '',
      lastActivity: '',
      lastActivityAge: '',
      commits: 0,
      autoFixRounds: 0,
      lastEscalation: '',
    });
    expect(
      sortActive([task('T-2', false), task('T-3', true), task('T-1', false)]).map((t) => t.id),
    ).toEqual(['T-3', 'T-1', 'T-2']);
  });
});
