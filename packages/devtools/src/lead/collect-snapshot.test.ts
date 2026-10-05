import { describe, expect, it } from 'vitest';
import { parseMergedLog } from './collect-snapshot';

describe('parseMergedLog', () => {
  it('parses a squash-merge subject', () => {
    const out = parseMergedLog('1700000000|T-0205: dashboard merged today after squash');
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:13:20.000Z' }]);
  });

  it('parses the old board subject', () => {
    const out = parseMergedLog('1700000000|board: T-0205 merged');
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:13:20.000Z' }]);
  });

  it('ignores lines that do not look like a merge', () => {
    const out = parseMergedLog('1700000000|work: T-0200 spec, playbook squash note, NOW');
    expect(out).toEqual([]);
  });

  it('returns one entry when the same task appears twice', () => {
    const out = parseMergedLog(
      ['1700000100|T-0205: newest squash subject', '1700000000|board: T-0205 merged'].join('\n'),
    );
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:15:00.000Z' }]);
  });

  it('returns [] for an empty input', () => {
    expect(parseMergedLog('')).toEqual([]);
  });
});
